import {
  deleteGalleryFiles,
  filterVisibleGallery,
  gallery,
  galleryKey,
  hideGalleryItems,
  saveGallery,
  setGallery,
  cleanupGalleryState,
  pageGallery,
  galleryDelta,
  galleryRevisionValue,
} from "./gallery-store.js";
import { galleryFilter, setGalleryFavorites } from "./gallery-store.js";
import { jobs } from "./jobs.js";
import { exportFilename, sendGalleryExport } from "./gallery-export.js";
import {
  ownerIdForRequest,
  recordBelongsToRequest,
  recordBelongsToAccount,
  recordsForRequest,
} from "./account-ownership.js";
import { mayUseFeature } from "./account-policy.js";
import { galleryAspects, gallerySizeBands, otherAspect } from "./gallery-filters.js";
import { canonicalProfileId } from "./profile-store.js";

function requireGalleryAccess(req, res) {
  if (!req.studioAccount || mayUseFeature(req.studioAccount, "gallery")) return true;
  res.status(403).json({ ok: false, error: "Gallery access is disabled for this account." });
  return false;
}

export function galleryJobResponse(account, id, settings = false) {
  if (account && !mayUseFeature(account, "gallery"))
    return {
      status: 403,
      payload: { ok: false, error: "Gallery access is disabled for this account.", items: [] },
    };
  cleanupGalleryState(jobs);
  const items = filterVisibleGallery(
    gallery.filter((item) => item.jobId === id && recordBelongsToAccount(item, account)),
  );
  const fields = [
    "jobId",
    "index",
    "status",
    "type",
    "url",
    ...(settings ? ["prompt", "negative", "width", "height", "settings", "assistant"] : []),
  ];
  return {
    status: 200,
    payload: {
      items: items.map((item) =>
        Object.fromEntries(fields.filter((key) => key in item).map((key) => [key, item[key]])),
      ),
    },
  };
}

/**
 * `jobChats(req)` maps the account's job IDs to the Chat that ran them, `{ id, title }`; items
 * carry it as `sessionId`, and `chat` (repeatable) filters by it.
 */
export function registerGalleryReadRoutes(app, { jobChats }) {
  /**
   * A gallery search from the query string, or null. `lora`, `model`, `size`
   * and `aspect` may repeat (any of them matches); `q` and `workflow` are
   * single values.
   */
  const many = (value) =>
    (Array.isArray(value) ? value : [value])
      .map((item) => String(item ?? "").slice(0, 200))
      .filter(Boolean)
      .slice(0, 50);
  function searchFilter(req) {
    const one = (value) => String((Array.isArray(value) ? value[0] : value) ?? "").slice(0, 200);
    return galleryFilter({
      q: one(req.query.q),
      favorites: req.query.favorites === "1",
      workflow: one(req.query.workflow),
      ...Object.fromEntries(
        ["lora", "model", "size", "aspect"].map((key) => [key, many(req.query[key])]),
      ),
    });
  }

  // Exact job reads avoid sorting and paging the full gallery for MCP results.
  app.get("/api/gallery/jobs/:id", (req, res) => {
    const result = galleryJobResponse(req.studioAccount, req.params.id, req.query.settings === "1");
    res.status(result.status).json(result.payload);
  });

  app.get("/api/gallery/filters", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    const type = String(req.query.type || "");
    const items = filterVisibleGallery(recordsForRequest(gallery, req)).filter(
      (item) => !type || item.type === type,
    );
    const chats = jobChats(req);
    const unique = (values) =>
      [...new Set(values.filter((value) => typeof value === "string" && value.trim()))].sort(
        (a, b) => a.localeCompare(b),
      );
    res.json({
      models: unique(
        items.flatMap((item) => [canonicalProfileId(item.model), item.settings?.modelName]),
      ),
      loras: unique(
        items.flatMap((item) =>
          (Array.isArray(item.settings?.loras) ? item.settings.loras : []).map(
            (lora) => lora?.name,
          ),
        ),
      ),
      sizes: gallerySizeBands.map((band) => ({
        value: band.id,
        label: band.label,
        description: band.detail,
      })),
      aspects: [
        ...galleryAspects.map((aspect) => ({ value: aspect.id, label: aspect.id })),
        { value: otherAspect, label: "Other" },
      ],
      chats: [
        ...new Map(
          items
            .map((item) => chats.get(item.jobId))
            .filter(Boolean)
            .map((chat) => [chat.id, { value: chat.id, label: chat.title }]),
        ).values(),
      ],
    });
  });

  // The newest finished image the account made with each LoRA, shown as its picker preview.
  app.get("/api/loras/previews", (req, res) => {
    if (req.studioAccount && !mayUseFeature(req.studioAccount, "gallery"))
      return res.json({ previews: {} });
    const newest = {};
    for (const item of filterVisibleGallery(recordsForRequest(gallery, req))) {
      if (item.status !== "done" || !item.thumbnailUrl) continue;
      const time = Date.parse(item.createdAt || "") || 0;
      for (const lora of Array.isArray(item.settings?.loras) ? item.settings.loras : [])
        if (lora?.name && lora.enabled !== false && !(newest[lora.name]?.time >= time))
          newest[lora.name] = { time, url: item.thumbnailUrl };
    }
    res.json({
      previews: Object.fromEntries(Object.entries(newest).map(([name, { url }]) => [name, url])),
    });
  });

  app.get("/api/gallery", (req, res) => {
    if (!requireGalleryAccess(req, res))
      return res.json({
        items: [],
        outputs: [],
        nextCursor: "",
        hasMore: false,
        totalApprox: 0,
        revision: 0,
      });
    cleanupGalleryState(jobs);
    const type = String(req.query.type || "");
    const limit = Number(req.query.limit || 0);
    const cursor = String(req.query.cursor || "");
    const includeFailed = req.query.includeFailed !== "0";
    const chats = jobChats(req);
    const chatIds = many(req.query.chat);
    const search = searchFilter(req);
    const page = pageGallery({
      type,
      limit: limit || 200,
      cursor,
      includeFailed,
      filter: (item) =>
        recordBelongsToRequest(item, req) &&
        (!chatIds.length || chatIds.includes(chats.get(item.jobId)?.id)) &&
        (!search || search(item)),
    });
    res.json({
      ...page,
      items: page.items.map((item) =>
        chats.has(item.jobId) ? { ...item, sessionId: chats.get(item.jobId).id } : item,
      ),
      // The whole list, for callers from before paging. A page is in `items` already.
      ...(cursor || limit
        ? {}
        : { outputs: filterVisibleGallery(recordsForRequest(gallery, req)) }),
    });
  });

  app.get("/api/gallery/delta", (req, res) => {
    if (!requireGalleryAccess(req, res))
      return res.json({ revision: 0, reset: false, upserts: [], removes: [] });
    const since = Number(req.query.since || 0);
    if (req.studioAccount) {
      const delta = galleryDelta({
        since,
        type: String(req.query.type || ""),
        includeFailed: req.query.includeFailed !== "0",
        owner: ownerIdForRequest(req),
        filter: searchFilter(req),
      });
      res.json(delta);
      return;
    }
    const type = String(req.query.type || "");
    const includeFailed = req.query.includeFailed !== "0";
    const delta = galleryDelta({
      since,
      type,
      includeFailed,
      filter: (item) =>
        recordBelongsToRequest(item, req) && (!searchFilter(req) || searchFilter(req)(item)),
    });
    res.json(delta);
  });
}

/** `starred` hears which of the caller's items changed, for the taste profile. */
export function registerGalleryHistoryRoutes(app, { starred = () => {} } = {}) {
  app.get("/api/gallery/export", (req, res) => {
    if (!requireGalleryAccess(req, res))
      return res
        .status(403)
        .json({ ok: false, error: "Gallery access is disabled for this account." });
    // `ids` (comma-separated) downloads a selection as one archive.
    const ids = String(req.query.ids || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 1000);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportFilename(ids.length ? "selection" : "gallery", "zip")}"`,
    );
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    sendGalleryExport(res, { req, ids: ids.length ? new Set(ids) : null });
  });

  /* ------------------------------------------ Favourites, prompts, earlier work */

  app.post("/api/gallery/favorite", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    const requested = new Set(
      (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 500),
    );
    const ids = recordsForRequest(gallery, req)
      .filter((item) =>
        [item.id, item.url, galleryKey(item)].some((key) => requested.has(String(key))),
      )
      .flatMap((item) => [item.id, item.url, galleryKey(item)]);
    const changed = setGalleryFavorites(ids, Boolean(req.body?.favorite));
    starred(req, changed, Boolean(req.body?.favorite));
    res.json({ ok: true, items: changed, revision: galleryRevisionValue() });
  });
}

export function registerGalleryErrorRoutes(app) {
  app.post("/api/gallery/errors/clear", (req, res) => {
    if (!requireGalleryAccess(req, res)) return;
    const clears = (item) =>
      recordBelongsToRequest(item, req) && (item.status === "error" || item.status === "canceled");
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
    if (req.studioAccount && !removed.length) {
      res.status(404).json({ ok: false, error: "That item was not found." });
      return;
    }
    const files = deleteGalleryFiles(removed);
    hideGalleryItems(removed);
    setGallery(
      gallery.filter(
        (item) => !recordBelongsToRequest(item, req) || (item.id !== id && item.url !== id),
      ),
    );
    if (removed.length) saveGallery();
    res.json({
      ok: true,
      files,
      removed: removed.length,
      outputs: filterVisibleGallery(recordsForRequest(gallery, req)),
    });
  });
}
