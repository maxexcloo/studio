import { ownerIdForRequest } from "./account-ownership.js";
import { mayUseFeature } from "./account-policy.js";
import {
  deleteUploadedReference,
  listReferenceAssets,
  readMultipartImage,
  readUploadedReference,
  referenceAssetFromGallery,
  referenceAssetMetadataForAccount,
  saveUploadedReference,
  saveUploadToGallery,
} from "./reference-assets.js";
import { requireLocal } from "./route-access.js";
import { saveStartImage } from "./start-images.js";

export function registerReferenceRoutes(app) {
  app.post("/api/start-image", (req, res) => {
    if (!requireLocal(req, res)) return;
    try {
      const result = saveStartImage({
        dataUrl: req.body?.dataUrl || req.body?.startImage || "",
        name: req.body?.name || req.body?.startImageName || "",
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/reference-assets", (req, res) => {
    try {
      const source = req.query.source === "generation" ? "generation" : "upload";
      const canReference =
        !req.studioAccount ||
        mayUseFeature(req.studioAccount, "imageReferences") ||
        mayUseFeature(req.studioAccount, "videoReferences");
      if (
        req.studioAccount &&
        (!canReference || (source === "generation" && !mayUseFeature(req.studioAccount, "gallery")))
      )
        return res.json({ items: [], hasMore: false });
      res.json(
        listReferenceAssets(req, {
          source,
          cursor: String(req.query.cursor || ""),
          limit: Number(req.query.limit || 60),
          q: String(req.query.q || ""),
        }),
      );
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/reference-assets/upload", async (req, res) => {
    const canReference =
      req.studioAccount &&
      (mayUseFeature(req.studioAccount, "imageReferences") ||
        mayUseFeature(req.studioAccount, "videoReferences"));
    if (!canReference && !requireLocal(req, res)) return;
    try {
      const upload = await readMultipartImage(req);
      const asset = await saveUploadedReference(upload, ownerIdForRequest(req));
      res.status(201).json({ ok: true, asset });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
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

  app.post("/api/reference-assets/:id/gallery", async (req, res) => {
    if (req.studioAccount && !mayUseFeature(req.studioAccount, "gallery"))
      return res
        .status(403)
        .json({ ok: false, error: "The gallery is disabled for this account." });
    if (!req.studioAccount && !requireLocal(req, res)) return;
    try {
      res.json({
        ok: true,
        item: await saveUploadToGallery(req.params.id, ownerIdForRequest(req)),
      });
    } catch (error) {
      res.status(404).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/reference-assets/:id", (req, res) => {
    try {
      const account = req.studioAccount;
      if (
        account &&
        !mayUseFeature(account, "imageReferences") &&
        !mayUseFeature(account, "videoReferences")
      )
        return res.status(404).json({ ok: false, error: "That reference image is gone." });
      const asset = referenceAssetMetadataForAccount(account, req.params.id);
      if (account && asset.source === "generation" && !mayUseFeature(account, "gallery"))
        return res.status(404).json({ ok: false, error: "That reference image is gone." });
      return res.json({ asset });
    } catch {
      return res.status(404).json({ ok: false, error: "That reference image is gone." });
    }
  });

  app.get("/api/reference-assets/:id/media", (req, res) => {
    if (
      req.studioAccount &&
      !mayUseFeature(req.studioAccount, "imageReferences") &&
      !mayUseFeature(req.studioAccount, "videoReferences")
    )
      return res.status(404).json({ ok: false, error: "That reference image is gone." });
    const asset = readUploadedReference(req.params.id, "media", ownerIdForRequest(req));
    if (!asset) return res.status(404).json({ ok: false, error: "That reference image is gone." });
    res.type(asset.mime).setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(asset.file);
  });

  app.get("/api/reference-assets/:id/thumbnail", (req, res) => {
    if (
      req.studioAccount &&
      !mayUseFeature(req.studioAccount, "imageReferences") &&
      !mayUseFeature(req.studioAccount, "videoReferences")
    )
      return res.status(404).json({ ok: false, error: "That reference image is gone." });
    const asset = readUploadedReference(req.params.id, "thumbnail", ownerIdForRequest(req));
    if (!asset) return res.status(404).json({ ok: false, error: "That reference image is gone." });
    res.type(asset.mime).setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(asset.file);
  });

  app.delete("/api/reference-assets/:id", (req, res) => {
    if (!req.studioAccount && !requireLocal(req, res)) return;
    try {
      res.json(deleteUploadedReference(req.params.id, ownerIdForRequest(req)));
    } catch (error) {
      res.status(404).json({ ok: false, error: error.message });
    }
  });
}
