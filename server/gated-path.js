/**
 * Whether a request path belongs to the studio's API or its ComfyUI proxy, which
 * every gate guards. Case-insensitive, like any path a client could send, so
 * /API/… or /Comfy/… can never slip past a gate that checks the lowercase prefix.
 */
export function gatedPath(value = "") {
  const path = String(value).toLowerCase();
  return path.startsWith("/api") || path.startsWith("/comfy");
}
