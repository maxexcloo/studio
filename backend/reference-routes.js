import { ownerIdForRequest } from "./account-ownership.js";
import { mayUseFeature } from "./account-policy.js";
import { clientOf } from "./access.js";
import { accountForRequest, multiUserEnabled } from "./multi-user-auth.js";
import {
  bytesForReferenceAccount,
  readMultipartImage,
  referenceAssetFromGallery,
  referenceAssetMetadataForAccount,
  saveUploadedImage,
} from "./references.js";
import { requireLocal } from "./route-access.js";

/** `uploaded(item)` hears of each new upload's gallery item, for image search. */
export function registerReferenceRoutes(app, { uploaded = () => {} } = {}) {
  app.post("/api/reference-assets/upload", async (req, res) => {
    const canReference =
      req.studioAccount &&
      (mayUseFeature(req.studioAccount, "imageReferences") ||
        mayUseFeature(req.studioAccount, "videoReferences"));
    if (!canReference && !requireLocal(req, res)) return;
    try {
      const { item, asset } = await saveUploadedImage(
        await readMultipartImage(req),
        ownerIdForRequest(req),
      );
      uploaded(item);
      res.status(201).json({ ok: true, asset });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // The installed app's share target (manifest.webmanifest): an image shared to Studio becomes a
  // reference and opens the composer with it. Another site's form post carries no session, and in
  // single-user mode the browser's own Sec-Fetch-Site marks it, so neither can add one.
  app.post("/share", async (req, res) => {
    const site = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    const account = multiUserEnabled ? accountForRequest(req) : null;
    const allowed =
      site !== "cross-site" &&
      site !== "same-site" &&
      (multiUserEnabled
        ? account &&
          (mayUseFeature(account, "imageReferences") || mayUseFeature(account, "videoReferences"))
        : clientOf(req).thisComputer);
    if (!allowed) return res.redirect(303, "/images");
    req.studioAccount = account;
    try {
      const { item, asset } = await saveUploadedImage(
        await readMultipartImage(req),
        ownerIdForRequest(req),
      );
      uploaded(item);
      res.redirect(303, `/images?compose=1&shared=${encodeURIComponent(asset.id)}`);
    } catch {
      res.redirect(303, "/images?compose=1");
    }
  });

  app.post("/api/reference-assets/from-gallery", (req, res) => {
    const canReference =
      req.studioAccount &&
      (mayUseFeature(req.studioAccount, "imageReferences") ||
        mayUseFeature(req.studioAccount, "videoReferences"));
    if (req.studioAccount && (!canReference || !mayUseFeature(req.studioAccount, "gallery")))
      return res
        .status(403)
        .json({ ok: false, error: "Gallery references are disabled for this account." });
    if (!canReference && !requireLocal(req, res)) return;
    try {
      const asset = referenceAssetFromGallery(req, String(req.body?.galleryItemId || ""), {
        frame: req.body?.frame === "last" ? "last" : "",
      });
      res.json({ ok: true, asset });
    } catch (error) {
      res.status(404).json({ ok: false, error: error.message });
    }
  });

  /**
   * The caller's own reference, or a throw. Accounts without the gallery reach their uploads but
   * not their generations.
   */
  function ownedReference(account, id) {
    if (
      account &&
      !mayUseFeature(account, "imageReferences") &&
      !mayUseFeature(account, "videoReferences")
    )
      throw new Error("References are off for this account.");
    const asset = referenceAssetMetadataForAccount(account, id);
    if (account && asset.source === "generation" && !mayUseFeature(account, "gallery"))
      throw new Error("The gallery is off for this account.");
    return asset;
  }
  const gone = (res) => res.status(404).json({ ok: false, error: "That reference image is gone." });

  app.get("/api/reference-assets/:id", (req, res) => {
    try {
      res.json({ asset: ownedReference(req.studioAccount, req.params.id) });
    } catch {
      gone(res);
    }
  });

  // The bytes a run would get for the reference, for the prompt assistant and MCP tools.
  app.get("/api/reference-assets/:id/media", async (req, res) => {
    try {
      ownedReference(req.studioAccount, req.params.id);
      const { buffer, mime } = await bytesForReferenceAccount(req.studioAccount, req.params.id);
      res.type(mime).setHeader("Cache-Control", "private, max-age=3600");
      res.send(buffer);
    } catch {
      gone(res);
    }
  });

  // Saved reference details carry this address; it leads to the reference's gallery thumbnail.
  app.get("/api/reference-assets/:id/thumbnail", (req, res) => {
    try {
      res.redirect(302, ownedReference(req.studioAccount, req.params.id).thumbnailUrl);
    } catch {
      gone(res);
    }
  });
}
