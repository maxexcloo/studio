import {
  filterVisibleGallery,
  gallery,
  galleryJobItems,
  hideGalleryItems,
  removeGalleryItems,
  saveGallery,
  setGallery,
  cleanupGalleryState,
  pageGallery,
  galleryRevisionValue,
} from "./store.js";
import { galleryFilter, setGalleryFavorites } from "./store.js";
import { galleryTime } from "./order.js";
import { exportFilename, sendGalleryExport } from "./export.js";
import { recordBelongsToAccount, recordsForRequest } from "../account-ownership.js";
import { galleryAspects, gallerySizeBands } from "./filters.js";
import { canonicalProfileId } from "../profile/store.js";
import { directRoute } from "../domain/direct-route.ts";
import { adminRefusal } from "../route-access.js";
import { galleryKey } from "../persistence/gallery-rows.ts";

export function galleryJobResponse(store, account, id, settings = false) {
  cleanupGalleryState(store);
  const items = filterVisibleGallery(
    galleryJobItems(id).filter((item) => recordBelongsToAccount(item, account)),
  );
  const fields = [
    "id",
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
 * carry it as `sessionId`, and `chat` (repeatable) filters by it. `near(q)` resolves to a test for
 * items that look like the search (domain/image-search.ts), or null.
 */
export function registerGalleryReadRoutes(app, { jobChats, near, store }) {
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
  async function searchFilter(query) {
    const one = (value) => String((Array.isArray(value) ? value[0] : value) ?? "").slice(0, 200);
    const q = one(query.q);
    return galleryFilter({
      q,
      near: await near(q),
      favorites: query.favorites === "1",
      workflow: one(query.workflow),
      ...Object.fromEntries(
        ["lora", "model", "size", "aspect"].map((key) => [key, many(query[key])]),
      ),
    });
  }

  // Exact job reads avoid sorting and paging the full gallery for MCP results.
  directRoute(app, "GET", "/api/gallery/jobs/:id", (account, { params, query }) =>
    galleryJobResponse(store, account, params.id, query.settings === "1"),
  );

  app.get("/api/gallery/filters", (req, res) => {
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
      aspects: galleryAspects.map((aspect) => ({ value: aspect.id, label: aspect.label })),
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

  directRoute(app, "GET", "/api/gallery", async (account, { query }) => {
    cleanupGalleryState(store);
    const type = String(query.type || "");
    const limit = Number(query.limit || 0);
    const cursor = String(query.cursor || "");
    const includeFailed = query.includeFailed !== "0";
    const chats = jobChats({ studioAccount: account });
    const chatIds = many(query.chat);
    const search = await searchFilter(query);
    // `since` (an ISO date) keeps items made from then on; work still generating always shows.
    const since = query.since ? Date.parse(String(query.since)) : 0;
    const page = pageGallery({
      type,
      limit: limit || 200,
      cursor,
      includeFailed,
      uploads: query.uploads === "1",
      filter: (item) =>
        recordBelongsToAccount(item, account) &&
        (!chatIds.length || chatIds.includes(chats.get(item.jobId)?.id)) &&
        // `set` keeps one MCP result set's results, which a Chat card links to.
        (!query.set || item.resultSet?.id === query.set) &&
        (!since || item.status === "pending" || galleryTime(item) >= since) &&
        (!search || search(item)),
    });
    // Next steps are asked for in the viewer (`/api/suggestions`), not carried in every page.
    const listed = ({ nextSteps: _steps, ...item }) => item;
    return {
      status: 200,
      payload: {
        ...page,
        items: page.items.map((item) =>
          chats.has(item.jobId)
            ? { ...listed(item), sessionId: chats.get(item.jobId).id }
            : listed(item),
        ),
      },
    };
  });
}

/** `starred` hears which of the caller's items changed, for the taste profile. */
export function registerGalleryHistoryRoutes(app, { starred = () => {} } = {}) {
  app.get("/api/gallery/export", (req, res) => {
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

  directRoute(app, "POST", "/api/gallery/favorite", (account, { body }) => {
    const requested = new Set((Array.isArray(body?.ids) ? body.ids : []).map(String).slice(0, 500));
    const ids = gallery
      .filter((item) => recordBelongsToAccount(item, account))
      .filter((item) =>
        [item.id, item.url, galleryKey(item)].some((key) => requested.has(String(key))),
      )
      .flatMap((item) => [item.id, item.url, galleryKey(item)]);
    const changed = setGalleryFavorites(ids, Boolean(body?.favorite));
    starred({ studioAccount: account }, changed, Boolean(body?.favorite));
    return { status: 200, payload: { ok: true, items: changed, revision: galleryRevisionValue() } };
  });
}

export function registerGalleryErrorRoutes(app) {
  // `owner` (administrators only) clears another account's failed items, or "all" every account's.
  directRoute(app, "POST", "/api/gallery/errors/clear", (account, { body }) => {
    const owner = body?.owner;
    const refusal = owner !== undefined && adminRefusal(account);
    if (refusal) return refusal;
    const mine = (item) => recordBelongsToAccount(item, account);
    const owned =
      owner === undefined ? mine : owner === "all" ? () => true : (item) => item.ownerId === owner;
    const clears = (item) =>
      owned(item) && (item.status === "failed" || item.status === "cancelled");
    const cleared = gallery.filter(clears);
    hideGalleryItems(cleared);
    setGallery(gallery.filter((item) => !clears(item)));
    saveGallery();
    return {
      status: 200,
      payload: {
        ok: true,
        cleared: cleared.length,
        outputs: filterVisibleGallery(gallery.filter(mine)),
      },
    };
  });
}

/** Deletes the request's own items named by ID (or URL); answers with the IDs it deleted. */
function deleteRequested(req, ids) {
  const wanted = new Set(ids.map(String));
  const removed = recordsForRequest(gallery, req).filter(
    (item) => wanted.has(item.id) || wanted.has(item.url),
  );
  const files = removeGalleryItems(removed);
  const matched = new Set(removed.flatMap((item) => [item.id, item.url]));
  return { files, removed: [...wanted].filter((id) => matched.has(id)) };
}

/** The visible gallery items each account owns, by owner ID. */
function ownedGalleries() {
  const owned = new Map();
  for (const item of filterVisibleGallery(gallery)) {
    if (!item.ownerId) continue;
    if (!owned.has(item.ownerId)) owned.set(item.ownerId, []);
    owned.get(item.ownerId).push(item);
  }
  return owned;
}

export function registerGalleryDeleteRoute(app) {
  // Administrators only (Settings › Users): each account's gallery size, and deleting all of one
  // account's items through the owner's own delete path.
  directRoute(app, "GET", "/api/gallery/owners", (account) => {
    const refusal = adminRefusal(account);
    if (refusal) return refusal;
    const counts = [...ownedGalleries()].map(([owner, items]) => [owner, items.length]);
    return { status: 200, payload: { ok: true, owners: Object.fromEntries(counts) } };
  });
  directRoute(app, "DELETE", "/api/gallery/owners/:id", (account, { params }) => {
    const refusal = adminRefusal(account);
    if (refusal) return refusal;
    const removed = ownedGalleries().get(params.id) || [];
    const files = removeGalleryItems(removed);
    return { status: 200, payload: { ok: true, removed: removed.length, files } };
  });
  // Many items in one request: one store change and one save, however many there are.
  directRoute(app, "POST", "/api/gallery/delete", (account, { body }) => {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    return {
      status: 200,
      payload: { ok: true, ...deleteRequested({ studioAccount: account }, ids) },
    };
  });
  app.delete("/api/gallery/:id", (req, res) => {
    // Express has already decoded the ID once; a finished item's ID is its URL, which keeps its own escapes.
    const id = req.params.id;
    const { files, removed } = deleteRequested(req, [id]);
    // Accounts never learn whether another owner's item exists.
    if (req.studioAccount && !removed.length) {
      console.warn(`[Studio] Could not delete gallery item ${id}: not among the account's items`);
      res.status(404).json({ ok: false, error: "That item was not found." });
      return;
    }
    res.json({
      ok: true,
      files,
      removed: removed.length,
      outputs: filterVisibleGallery(recordsForRequest(gallery, req)),
    });
  });
}
