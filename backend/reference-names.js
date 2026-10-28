import crypto from "node:crypto";

/**
 * The name an image gets in ComfyUI's input folder when a run uses it as a
 * reference (references.js). It is named by its content, so the same
 * picture is uploaded once.
 */
export function mimeExtension(mime = "") {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

export function referenceInputName(buffer, mime = "") {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  return `studio-reference-${hash}.${mimeExtension(mime)}`;
}
