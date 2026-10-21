import { addGalleryItems, deleteGalleryFiles, filterVisibleGallery, gallery, galleryKey, hideGalleryItems, saveGallery, setGallery, cleanupGalleryState, pageGallery, galleryDelta, galleryRevisionValue, sortGallery } from './gallery-store.js';
import { galleryFilter, setGalleryFavorites } from './gallery-store.js';
import { emptyTrash, restoreTrash, trashGalleryItems, trashSummary } from './gallery-trash.js';
import { jobs } from './jobs.js';
import { applyBundles, createBundles, DEFAULT_COOLDOWN_MINUTES, dissolveBundle, listBundles, pendingSummary, setBundleCover } from './gallery-bundles.js';
import { exportFilename, sendGalleryExport } from './gallery-export.js';
import { ownerIdForRequest, recordBelongsToRequest, recordsForRequest } from './account-ownership.js';
import { mayUseFeature } from './account-policy.js';
import { requireAdmin, requireLocal } from "./route-access.js";

function requireGalleryAccess(req, res) {
  if (!req.studioAccount || mayUseFeature(req.studioAccount, 'gallery')) return true;
  res.status(403).json({ ok: false, error: 'Gallery access is disabled for this account.' });
  return false;
}

export function registerGalleryBundleRoutes(app) {
  function bundleOptions(source = {}) {
    return {
      mode: source.mode === "job" ? "job" : "smart",
      cooldownMinutes: Math.max(0, Math.min(1440, Number(source.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES)))
    };
  }

  function bundleSourceItems(req) {
    return filterVisibleGallery(recordsForRequest(gallery, req)).filter((item) => item.status !== "canceled");
  }

  app.get("/api/gallery/bundles", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    const options = bundleOptions(req.query);
    res.json({ bundles: req.studioAccount ? [] : listBundles(), pending: pendingSummary(bundleSourceItems(req), options), ...options });
  });

  app.post("/api/gallery/bundles/compact", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    if (!requireLocal(req, res)) return;
    const options = bundleOptions(req.body || {});
    const created = createBundles(bundleSourceItems(req), options);
    res.json({
      ok: true,
      created: created.length,
      items: created.reduce((total, bundle) => total + bundle.itemIds.length, 0),
      // The browser plays the settle animation on just these, so scrolling an
      // existing stack back into view does not replay it.
      ids: created.map((bundle) => bundle.id)
    });
  });
}

export function registerGalleryBundleActions(app) {
  app.post("/api/gallery/bundles/:id/cover", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    if (!requireLocal(req, res)) return;
    if (req.studioAccount) { res.status(404).json({ ok: false, error: "Bundles are unavailable in account mode." }); return; }
    try {
      res.json(setBundleCover(String(req.params.id), String(req.body?.itemId || "")));
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/gallery/bundles/:id", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    if (!requireLocal(req, res)) return;
    if (req.studioAccount) { res.status(404).json({ ok: false, error: "Bundles are unavailable in account mode." }); return; }
    try {
      res.json(dissolveBundle(String(req.params.id)));
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}

export function registerGalleryReadRoutes(app) {
  /**
   * A gallery search from the query string, or null. Search results are never
   * stacked. `lora`, `model`, `size` and `aspect` may repeat (any of them
   * matches); `q` and `workflow` are single values.
   */
  function searchFilter(req) {
    const many = (value) => (Array.isArray(value) ? value : [value]).map((item) => String(item ?? "").slice(0, 200)).filter(Boolean).slice(0, 50);
    const one = (value) => String((Array.isArray(value) ? value[0] : value) ?? "").slice(0, 200);
    return galleryFilter({
      q: one(req.query.q),
      favorites: req.query.favorites === "1",
      workflow: one(req.query.workflow),
      ...Object.fromEntries(["lora", "model", "size", "aspect"].map((key) => [key, many(req.query[key])]))
    });
  }

  /** The gallery with its runs collapsed; a run can straddle a page, so it collapses first. */
  function bundledPage(req) {
    const type = String(req.query.type || "");
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
    const cursor = String(req.query.cursor || "");
    const includeFailed = req.query.includeFailed !== "0";
    const filter = searchFilter(req);
    const merged = sortGallery(filterVisibleGallery(recordsForRequest(gallery, req))).filter((item) => {
      if (type && item.type !== type) return false;
      if (!includeFailed && item.status === "error") return false;
      if (filter && !filter(item)) return false;
      return item.status !== "canceled";
    });
    const collapsed = applyBundles(merged, { enabled: !req.studioAccount && req.query.bundles !== "0" && !filter });
    const start = cursor ? Math.max(0, collapsed.findIndex((item) => String(item.id) === cursor) + 1) : 0;
    const items = collapsed.slice(start, start + limit);
    const nextCursor = start + limit < collapsed.length ? String(items.at(-1)?.id || "") : "";
    return { items, nextCursor, hasMore: Boolean(nextCursor), revision: galleryRevisionValue(), totalApprox: collapsed.length };
  }

  // Exact job reads avoid sorting and paging the full gallery for MCP results.
  app.get("/api/gallery/jobs/:id", (req, res) => {
    if (!requireGalleryAccess(req, res)) return res.json({ items: [] });
    cleanupGalleryState(jobs);
    const items = filterVisibleGallery(recordsForRequest(gallery, req).filter((item) => item.jobId === req.params.id));
    // Prompts and settings only on request: MCP reads them to run a finished result again or animate it.
    const fields = ["jobId", "index", "status", "type", "url", ...(req.query.settings === "1" ? ["prompt", "negative", "width", "height", "settings"] : [])];
    res.json({ items: items.map((item) => Object.fromEntries(
      fields.filter((key) => key in item).map((key) => [key, item[key]])
    )) });
  });

  app.get("/api/gallery", (req, res) => {
    if (!requireGalleryAccess(req, res)) return res.json({ items: [], outputs: [], nextCursor: '', hasMore: false, totalApprox: 0, revision: 0 });
    cleanupGalleryState(jobs);
    const type = String(req.query.type || "");
    const limit = Number(req.query.limit || 0);
    const cursor = String(req.query.cursor || "");
    const includeFailed = req.query.includeFailed !== "0";
    const page = !req.studioAccount && listBundles().length
      ? bundledPage(req)
      : pageGallery({ type, limit: limit || 200, cursor, includeFailed, filter: (item) => recordBelongsToRequest(item, req) && (!searchFilter(req) || searchFilter(req)(item)) });
    res.json({
      ...page,
      // The whole list, for callers from before paging. A page is in `items` already.
      ...(cursor || limit ? {} : { outputs: filterVisibleGallery(recordsForRequest(gallery, req)) })
    });
  });

  app.get("/api/gallery/delta", (req, res) => {
    if (!requireGalleryAccess(req, res)) return res.json({ revision: 0, reset: false, upserts: [], removes: [] });
    const since = Number(req.query.since || 0);
    if (req.studioAccount) {
      // Bundles are off in account mode, so the owner's own changes patch in place.
      const delta = galleryDelta({ since, type: String(req.query.type || ""), includeFailed: req.query.includeFailed !== "0", owner: ownerIdForRequest(req), filter: searchFilter(req) });
      res.json(delta);
      return;
    }
    // Collapsed runs only come out of a full page, so with any run grouped the
    // browser reloads rather than patching tiles in and out of their stacks -
    // but only when something actually changed since its last page.
    if (listBundles().length) {
      const revision = galleryRevisionValue();
      res.json({ revision, reset: since !== revision, upserts: [], removes: [] });
      return;
    }
    const type = String(req.query.type || "");
    const includeFailed = req.query.includeFailed !== "0";
    const delta = galleryDelta({ since, type, includeFailed, filter: (item) => recordBelongsToRequest(item, req) && (!searchFilter(req) || searchFilter(req)(item)) });
    res.json(delta);
  });
}

export function registerGalleryHistoryRoutes(app, { recoverGalleryFromHistory }) {
  app.get("/api/gallery/export", (req, res) => {
    if (!requireGalleryAccess(req, res)) return res.status(403).json({ ok: false, error: 'Gallery access is disabled for this account.' });
    // `ids` (comma-separated) downloads a selection as one archive.
    const ids = String(req.query.ids || "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 1000);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename(ids.length ? "selection" : "gallery", "zip")}"`);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    sendGalleryExport(res, { req, ids: ids.length ? new Set(ids) : null });
  });

  app.post("/api/gallery/recover", async (req, res) => {
    if (!requireLocal(req, res)) return;
    await recoverGalleryFromHistory();
    res.json({ ok: true, revision: galleryRevisionValue() });
  });

  /* ------------------------------------------ Favourites, prompts, earlier work */

  app.post("/api/gallery/favorite", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    const requested = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 500));
    const ids = recordsForRequest(gallery, req).filter((item) => [item.id, item.url, galleryKey(item)].some((key) => requested.has(String(key)))).flatMap((item) => [item.id, item.url, galleryKey(item)]);
    const changed = setGalleryFavorites(ids, Boolean(req.body?.favorite));
    res.json({ ok: true, items: changed, revision: galleryRevisionValue() });
  });
}

export function registerGalleryTrashRoutes(app) {
  app.post("/api/gallery/clear", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    if (!requireAdmin(req, res)) return;
    // Clearing the gallery never touches images shown from another folder (library.js): their files are not in the output
    // folder, so no trash could bring them back; Settings › Library removes those.
    const clears = (item) => recordBelongsToRequest(item, req) && item.status === "done" && !item.library;
    const cleared = gallery.filter(clears);
    // Into the trash, not deleted: it can be put back until the trash empties itself (gallery-trash.js).
    const trash = trashGalleryItems(cleared);
    hideGalleryItems(cleared);
    setGallery(gallery.filter((item) => !clears(item)));
    saveGallery();
    res.json({ ok: true, files: { deleted: trash.moved, skipped: trash.skipped }, trash: { batch: trash.batch, moved: trash.moved, days: trashSummary(undefined, ownerIdForRequest(req)).days }, outputs: filterVisibleGallery(recordsForRequest(gallery, req)) });
  });

  app.get("/api/gallery/trash", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    if (!requireAdmin(req, res)) return;
    res.json({ ok: true, ...trashSummary(undefined, ownerIdForRequest(req)) });
  });

  // Undo for a clear, or Settings' Restore: the newest batch unless one is named.
  app.post("/api/gallery/trash/restore", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    if (!requireAdmin(req, res)) return;
    try {
      const { restored, missing } = restoreTrash(String(req.body?.batch || ""), undefined, ownerIdForRequest(req));
      if (restored.length) addGalleryItems(restored);
      res.json({ ok: true, restored: restored.length, missing, revision: galleryRevisionValue(), trash: trashSummary(undefined, ownerIdForRequest(req)), outputs: filterVisibleGallery(recordsForRequest(gallery, req)) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/gallery/trash/empty", async (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    if (!requireAdmin(req, res)) return;
    try {
      const removed = await emptyTrash(undefined, ownerIdForRequest(req));
      res.json({ ok: true, removed, trash: trashSummary(undefined, ownerIdForRequest(req)) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/gallery/errors/clear", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    const clears = (item) => recordBelongsToRequest(item, req) && (item.status === "error" || item.status === "canceled");
    const cleared = gallery.filter(clears);
    hideGalleryItems(cleared);
    setGallery(gallery.filter((item) => !clears(item)));
    saveGallery();
    res.json({ ok: true, outputs: filterVisibleGallery(recordsForRequest(gallery, req)) });
  });
}

export function registerGalleryDeleteRoute(app) {
  app.delete("/api/gallery/:id", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    const id = decodeURIComponent(req.params.id);
    const owned = recordsForRequest(gallery, req);
    const removed = owned.filter((item) => item.id === id || item.url === id);
    // Accounts never learn whether another owner's item exists.
    if (req.studioAccount && !removed.length) { res.status(404).json({ ok: false, error: "That item was not found." }); return; }
    const files = deleteGalleryFiles(removed);
    hideGalleryItems(removed);
    setGallery(gallery.filter((item) => !recordBelongsToRequest(item, req) || item.id !== id && item.url !== id));
    if (removed.length) saveGallery();
    res.json({ ok: true, files, removed: removed.length, outputs: filterVisibleGallery(recordsForRequest(gallery, req)) });
  });
}
