import { ownerIdForRequest } from "./account-ownership.js";
import { clientOf } from "./access.js";
import { directRoute } from "./domain/direct-route.ts";
import { accountForRequest, multiUserEnabled } from "./multi-user-auth.js";
import {
  bytesForReferenceAccount,
  readMultipartUpload,
  referenceAssetForAccount,
  referenceAssetMetadataForAccount,
  saveUpload,
} from "./references.js";
import { localRefusal, requireLocal } from "./route-access.js";

/** `uploaded(item)` hears of each new upload's gallery item, for image search. */
export function registerReferenceRoutes(app, { uploaded = () => {} } = {}) {
  // The form's file becomes the `upload` the shared route takes; MCP passes its own.
  app.post("/api/reference-assets/upload", async (req, res, next) => {
    try {
      req.body = { upload: await readMultipartUpload(req) };
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    next();
  });
  directRoute(app, "POST", "/api/reference-assets/upload", async (account, { body }) => {
    const refusal = !account && localRefusal(account);
    if (refusal) return refusal;
    try {
      const { item, asset } = await saveUpload(body.upload, account?.userId || "");
      uploaded(item);
      return { status: 201, payload: { ok: true, asset } };
    } catch (error) {
      return { status: 400, payload: { ok: false, error: error.message } };
    }
  });

  // The installed app's share target (manifest.webmanifest): an image or video shared to Studio is
  // saved as an upload and opens the composer with it (a video's first frame) as a reference. Another site's form post carries no session, and in
  // single-user mode the browser's own Sec-Fetch-Site marks it, so neither can add one.
  app.post("/share", async (req, res) => {
    const site = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    const account = multiUserEnabled ? accountForRequest(req) : null;
    const allowed =
      site !== "cross-site" &&
      site !== "same-site" &&
      (multiUserEnabled ? Boolean(account) : clientOf(req).thisComputer);
    if (!allowed) return res.redirect(303, "/images");
    req.studioAccount = account;
    try {
      const { item, asset } = await saveUpload(
        await readMultipartUpload(req),
        ownerIdForRequest(req),
      );
      uploaded(item);
      res.redirect(303, `/images?compose=1&shared=${encodeURIComponent(asset.id)}`);
    } catch {
      res.redirect(303, "/images?compose=1");
    }
  });

  // A video's frame (milliseconds in, or "last") kept as an image of its own, listed under Uploads.
  app.post("/api/gallery/frame", async (req, res) => {
    if (!req.studioAccount && !requireLocal(req, res)) return;
    const frame = req.body?.frame;
    try {
      const reference = referenceAssetForAccount(
        req.studioAccount,
        String(req.body?.galleryItemId || ""),
        {
          frame: Number.isInteger(frame) && frame >= 0 ? frame : "last",
        },
      );
      const { item, asset } = await saveUpload(
        await bytesForReferenceAccount(req.studioAccount, reference.id),
        ownerIdForRequest(req),
      );
      uploaded(item);
      res.status(201).json({ ok: true, asset });
    } catch (error) {
      res.status(404).json({ ok: false, error: error.message });
    }
  });

  directRoute(app, "POST", "/api/reference-assets/from-gallery", (account, { body }) => {
    const refusal = !account && localRefusal(account);
    if (refusal) return refusal;
    try {
      const asset = referenceAssetForAccount(account, String(body?.galleryItemId || ""), {
        // A video's last frame, or the one at a time in milliseconds.
        frame:
          body?.frame === "last" || (Number.isInteger(body?.frame) && body.frame >= 0)
            ? body.frame
            : "",
      });
      return { status: 200, payload: { ok: true, asset } };
    } catch (error) {
      return { status: 404, payload: { ok: false, error: error.message } };
    }
  });

  const gone = (res) => res.status(404).json({ ok: false, error: "That reference image is gone." });

  app.get("/api/reference-assets/:id", (req, res) => {
    try {
      res.json({ asset: referenceAssetMetadataForAccount(req.studioAccount, req.params.id) });
    } catch {
      gone(res);
    }
  });

  // The bytes a run would get for the reference, for the prompt assistant and MCP tools.
  directRoute(app, "GET", "/api/reference-assets/:id/media", async (account, { params }) => {
    try {
      referenceAssetMetadataForAccount(account, params.id);
      const { buffer, mime } = await bytesForReferenceAccount(account, params.id);
      return {
        status: 200,
        content: buffer,
        mime,
        headers: { "Cache-Control": "private, max-age=3600" },
      };
    } catch {
      return { status: 404, payload: { ok: false, error: "That reference image is gone." } };
    }
  });

  // Saved reference details carry this address; it leads to the reference's gallery thumbnail.
  app.get("/api/reference-assets/:id/thumbnail", (req, res) => {
    try {
      res.redirect(
        302,
        referenceAssetMetadataForAccount(req.studioAccount, req.params.id).thumbnailUrl,
      );
    } catch {
      gone(res);
    }
  });
}
