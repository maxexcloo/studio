import { notifications } from "@mantine/notifications";

// A deploy restarts Studio's one instance. Requests wait this long for it, retrying only answers
// given before Studio handled them: its own 503 while it stops (with Retry-After) and the proxy's
// 503 while no instance runs. Reads also retry other gateway failures and an unreachable Studio.
const restartWaitMs = 20_000;

function restarting(response: Response, read: boolean) {
  if (response.status === 503 && response.headers.has("Retry-After")) return true;
  if (response.headers.get("Content-Type")?.includes("json")) return false;
  return response.status === 503 || (read && [502, 504].includes(response.status));
}
function pause(signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, 1000);
    if (signal?.aborted) stop();
    signal?.addEventListener("abort", stop, { once: true });
  });
}
export async function request(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("X-Studio", "1");
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const read = ["GET", "HEAD"].includes(options.method?.toUpperCase() ?? "GET");
  const deadline = Date.now() + restartWaitMs;
  let response: Response;
  for (;;) {
    try {
      response = await fetch(url, { ...options, headers, credentials: "same-origin" });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      if (read && Date.now() < deadline) {
        await pause(options.signal);
        continue;
      }
      throw new Error("Can't reach Studio. Try again in a moment.", { cause: error });
    }
    if (!restarting(response, read) || Date.now() >= deadline) break;
    void response.body?.cancel();
    await pause(options.signal);
  }
  if (response.status === 401) window.dispatchEvent(new Event("studio:signed-out"));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    // The body stays as the cause, for refusals that say more than their message.
    // Gateway failures come from the proxy while Studio restarts, as during a deploy.
    const fallback = [502, 503, 504].includes(response.status)
      ? "Studio is restarting. Try again in a moment."
      : `Studio returned ${response.status}`;
    throw Object.assign(new Error(data.error || fallback, { cause: data }), {
      status: response.status,
    });
  }
  return response;
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  return (await request(url, options)).json();
}
export const post = <T>(url: string, value?: unknown) =>
  api<T>(url, { method: "POST", body: JSON.stringify(value ?? {}) });
export function failure(error: unknown) {
  notifications.show({
    color: "red",
    message: error instanceof Error ? error.message : String(error),
    position: "top-right",
    role: "alert",
    autoClose: 8000,
  });
}
