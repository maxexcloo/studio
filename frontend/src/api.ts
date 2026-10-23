import { notifications } from "@mantine/notifications";

export async function request(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("X-Studio", "1");
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (response.status === 401) window.dispatchEvent(new Event("studio:signed-out"));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Studio returned ${response.status}`);
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
    title: "Couldn’t Complete the Action",
    message: error instanceof Error ? error.message : String(error),
    autoClose: false,
  });
}
