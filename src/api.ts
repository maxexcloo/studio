import { notifications } from "@mantine/notifications";

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("X-Studio", "1");
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (response.status === 401) window.dispatchEvent(new Event("studio:signed-out"));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Studio returned ${response.status}`);
  return data as T;
}
export const post = <T>(url: string, value?: unknown) =>
  api<T>(url, { method: "POST", body: JSON.stringify(value ?? {}) });
export function failure(error: unknown) {
  notifications.show({
    color: "red",
    title: "Couldn’t Complete the Action",
    message: error instanceof Error ? error.message : String(error),
    autoClose: false,
  });
}
