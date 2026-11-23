import crypto from "node:crypto";
import path from "node:path";

import sharp from "sharp";

export const maxUploadMegabytes = 20;
export const maxUploadBytes = maxUploadMegabytes * 1_000_000;
export const maxUploadBase64 = maxUploadBytes * 1.4;
export const uploadLinkMinutes = 15;

export const attachmentInstructions =
  "When the user asks to use a chat attachment, search with uploads: true, kind: image, and the exact filename if known. Omit query if the filename is unknown or the filename search misses. Use a confirmed match in reference_asset_ids. If missing or ambiguous, give the user an upload_link and wait for their upload before generating.";
const tooLarge = `Reference images must be at most ${maxUploadMegabytes} MB.`;
const uploadReferencePattern = /^upload-link:[A-Za-z0-9_-]{16}$/;
const uploadLinkMs = uploadLinkMinutes * 60 * 1000;

export class McpReferenceUploads {
  #media;
  #openLinks = new Map();

  constructor(media) {
    this.#media = media;
  }

  /**
   * A one-time upload page's link (UploadLink) for the owner and the reference its image becomes:
   * sealed like a result link, it takes one image within uploadLinkMs. Open links are held in
   * memory only, so a restart ends them.
   */
  link(owner) {
    const now = Date.now();
    for (const [nonce, expires] of this.#openLinks)
      if (expires <= now) this.#openLinks.delete(nonce);
    const nonce = crypto.randomBytes(16).toString("base64url");
    const expires = now + uploadLinkMs;
    this.#openLinks.set(nonce, expires);
    const reference = `upload-link:${crypto.randomBytes(12).toString("base64url")}`;
    const token = this.#media.seal("u2", {
      audience: this.#media.publicUrl,
      owner,
      nonce,
      expires,
      reference,
    });
    return { url: `${this.#media.publicUrl}/mcp/results/upload/${token}`, expires, reference };
  }
  /** An open upload link's claims, or a throw once it is used, expired, altered or for another studio. */
  claims(token) {
    const parts = String(token || "").split(".");
    if (parts[0] !== "u2") throw new Error("Invalid upload link.");
    const claims = this.#media.unseal(parts);
    if (
      claims.audience !== this.#media.publicUrl ||
      !(claims.expires > Date.now()) ||
      this.#openLinks.get(claims.nonce) !== claims.expires
    )
      throw new Error("Invalid upload link.");
    return claims;
  }
  isOpen({ nonce }) {
    return this.#openLinks.has(nonce);
  }
  /** Saves the page's image as the link owner's upload and closes the link; a failed save leaves it open. */
  async redeem(claims, file, credential) {
    if (!this.#openLinks.delete(claims.nonce)) throw new Error("Invalid upload link.");
    try {
      const { asset } = await this.store(claims.owner, file.buffer, file.name, { credential });
      this.#media.rows.setUpload(claims.reference, asset.id);
      return asset;
    } catch (error) {
      if (claims.expires > Date.now()) this.#openLinks.set(claims.nonce, claims.expires);
      throw error;
    }
  }
  /** A reference_asset_id, with an upload link's reference resolved to the asset its image became. */
  resolve(id) {
    if (!uploadReferencePattern.test(id)) return id;
    const asset = this.#media.rows.upload(id);
    if (asset) return asset;
    throw new Error(
      "The user hasn't uploaded the image through its upload link yet. Ask them to, then call again; if the link has expired, call upload_link for a new one.",
    );
  }
  async fromBase64(owner, base64, filename = "reference.png") {
    if (base64.length > maxUploadBase64) throw new Error(tooLarge);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
      throw new Error(`That isn't a base64 PNG, JPEG or WebP image. ${attachmentInstructions}`);
    return this.store(owner, Buffer.from(base64, "base64"), filename, {
      advice: ` For a Studio result, call reuse with mode reference and its ref. ${attachmentInstructions}`,
    });
  }
  /**
   * Saves an image as the owner's Studio upload through the studio's own upload route, so the
   * owner's tools take its reference. A HEIC photo becomes a JPEG when sharp can read it.
   */
  async store(owner, content, filename, { credential, advice = "" } = {}) {
    if (content.length > maxUploadBytes) throw new Error(tooLarge);
    let metadata = {};
    try {
      if (content.length)
        metadata = await sharp(content, { limitInputPixels: 80000000 }).metadata();
    } catch {
      /* Not an image. */
    }
    if (metadata.format === "heif")
      try {
        content = await sharp(content, { limitInputPixels: 80000000 })
          .rotate()
          .jpeg({ quality: 92 })
          .toBuffer();
        metadata = await sharp(content).metadata();
        filename = `${path.basename(filename).replace(/\.[a-z0-9]+$/i, "")}.jpg`;
      } catch {
        throw new Error("Studio can't read this HEIC photo. Choose a PNG, JPEG or WebP image.");
      }
    if (!["png", "jpeg", "webp"].includes(metadata.format))
      throw new Error(`That isn't a PNG, JPEG or WebP image.${advice}`);
    // A chat model without the image's bytes tends to send a made-up few-pixel image, which a model's encoder rejects.
    if (Math.min(metadata.width, metadata.height) < 32)
      throw new Error(`This image is only a few pixels, so it is not the real picture.${advice}`);
    const upload = {
      buffer: content,
      name: path.basename(filename),
      mime: `image/${metadata.format}`,
    };
    const result = await this.#media.request(
      "POST",
      "/api/reference-assets/upload",
      { upload },
      owner,
      { credential },
    );
    if (!result.asset?.id) throw new Error("Studio could not accept this reference image.");
    this.#media.adopt(owner, "", { assets: [result.asset.id] });
    return result;
  }
}
