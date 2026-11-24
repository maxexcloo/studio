/**
 * The longest edge of the viewer's display copy (backend/thumbnails.js): a WebP that holds every
 * pixel of a picture no larger, at a fraction of the original's bytes.
 */
export const displayEdge = 2560;

/** Old video records can name only the original; the same address serves a still under /thumb. */
export function videoPosterUrl(url?: string) {
  return url?.startsWith("/comfy/view?") ? url.replace("/comfy/view?", "/comfy/thumb?") : undefined;
}

/** Saved text a result can be recreated from without asking the assistant to describe it. */
export function recreationPrompt(item: {
  prompt?: string;
  suggestedPrompt?: string;
  caption?: { text?: string };
}) {
  return item.prompt?.trim() || item.suggestedPrompt?.trim() || item.caption?.text?.trim() || "";
}
