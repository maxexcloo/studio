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
  galleryItem,
  resultNumbers,
  visibleGallery,
} from "./store.js";
import crypto from "node:crypto";
import fs from "node:fs";
import { galleryFilter, outputFileCandidates, setGalleryFavorites } from "./store.js";
import { galleryTime } from "./order.js";
import { makePendingItems } from "./records.js";
import { exportFilename, sendGalleryExport } from "./export.js";
import {
  ownerIdForRequest,
  recordBelongsToAccount,
  recordsForRequest,
} from "../account-ownership.js";
import { accountPreferences } from "../account-preferences.js";
import { galleryAspects, gallerySizeBands, topCaptionTags } from "./filters.js";
import { canonicalProfileId } from "../profile/store.js";
import { directRoute } from "../domain/direct-route.ts";
import { queuePriority } from "../domain/store.ts";
import { adminRefusal } from "../route-access.js";
import { galleryKey } from "../persistence/gallery-rows.ts";
import { galleryStats } from "../stats.js";

export function galleryJobResponse(store, account, id, settings = false) {
  cleanupGalleryState(store);
  const items = resultNumbers.numbered(
    filterVisibleGallery(
      galleryJobItems(id).filter((item) => recordBelongsToAccount(item, account)),
    ),
  );
  const fields = [
    "id",
    "jobId",
    "index",
    "number",
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
 * `near(q)` resolves to a test for items that look like the search (domain/image-search.ts), or null; `similar(item)` scores items
 * by how alike they look to it, or is null when it can't. `compared(ownerId)` tests whether an item
 * is in one of the owner's comparisons.
 */
export function registerGalleryReadRoutes(app, { near, similar, store, compared }) {
  /**
   * A gallery search from the query string, or null. `lora`, `model`, `size`,
   * `aspect` and `tag` may repeat (any of them matches); `q` and `workflow` are
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
        ["lora", "model", "size", "aspect", "tag"].map((key) => [key, many(query[key])]),
      ),
    });
  }

  // Exact job reads avoid sorting and paging the full gallery for MCP results.
  directRoute(app, "GET", "/api/gallery/jobs/:id", (account, { params, query }) =>
    galleryJobResponse(store, account, params.id, query.settings === "1"),
  );

  app.get("/api/gallery/filters", (req, res) => {
    const type = String(req.query.type || "");
    const items = recordsForRequest(visibleGallery(), req).filter(
      (item) => !type || item.type === type,
    );
    const unique = (values) =>
      [...new Set(values.filter((value) => typeof value === "string" && value.trim()))].sort(
        (a, b) => a.localeCompare(b),
      );
    res.json({
      // Each recorded model resolves once: resolving reads the alias file's state.
      models: unique([
        ...[...new Set(items.map((item) => item.model))].map(canonicalProfileId),
        ...items.map((item) => item.settings?.modelName),
      ]),
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
      tags: topCaptionTags(items),
    });
  });

  // The newest finished image the account made with each LoRA, shown as its picker preview.
  app.get("/api/loras/previews", (req, res) => {
    const newest = {};
    for (const item of recordsForRequest(visibleGallery(), req)) {
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
    const search = await searchFilter(query);
    // `since` (an ISO date) keeps items made from then on; work still generating always shows.
    const since = query.since ? Date.parse(String(query.since)) : 0;
    // `similar` (an item id, Find Similar) ranks by likeness to that image; none until it is read.
    const source = query.similar ? galleryItem(String(query.similar)) : null;
    const similarTo = query.similar
      ? (source && recordBelongsToAccount(source, account) && similar(source)) || (() => undefined)
      : null;
    // `comparisons` keeps results that are in one of the account's comparisons.
    const inComparison = query.comparisons === "1" ? compared(account?.userId || "") : null;
    // Unfinished work shows only as the account chooses (Settings › Preferences › Gallery): none,
    // work in progress, or queued work too; unsaved, none.
    const work = accountPreferences(account?.userId || "").galleryWork || "none";
    const page = pageGallery({
      rank: similarTo,
      type,
      limit: limit || 200,
      cursor,
      includeFailed,
      uploads: query.uploads === "1",
      // The account and every parameter but the page's own name the filter's list.
      filterKey: JSON.stringify([
        account?.userId ?? "",
        work,
        Object.entries(query).filter(([key]) => key !== "cursor" && key !== "limit"),
      ]),
      filter: (item) =>
        recordBelongsToAccount(item, account) &&
        // `set` keeps one MCP result set's results.
        (!query.set || item.resultSet?.id === query.set) &&
        (!inComparison || inComparison(item)) &&
        (work !== "none" || item.status !== "pending") &&
        (!since || item.status === "pending" || galleryTime(item) >= since) &&
        (!search || search(item)),
    });
    // Next steps are asked for in the viewer (`/api/suggestions`) and the prompt's thinking (up to
    // 20,000 characters) in Details (`/api/gallery/items/:id`), not carried in every page.
    const listed = ({ nextSteps: _steps, ...item }) => {
      if (!item.writing?.thinking) return item;
      const { thinking: _thinking, ...writing } = item.writing;
      return { ...item, writing };
    };
    // Work the queue holds has no tiles until it starts; with queued work shown, the first page
    // leads with them. Dream's stays in its own pool; an upscale has no tile.
    const queued =
      work !== "queued" || cursor || similarTo || query.uploads === "1"
        ? []
        : store
            .openJobs(account?.userId || "")
            .filter(
              (job) =>
                job.priority !== queuePriority.dream &&
                !job.cleared &&
                job.operation !== "upscale" &&
                !galleryJobItems(job.id).length,
            )
            .reverse()
            .flatMap((job) =>
              makePendingItems(job.id, {
                ...job.input,
                ownerId: account?.userId || "",
                createdAt: job.createdAt,
              }),
            )
            .filter(
              (item) =>
                (!type || item.type === type) &&
                recordBelongsToAccount(item, account) &&
                (!query.set || item.resultSet?.id === query.set) &&
                (!inComparison || inComparison(item)) &&
                (!search || search(item)),
            );
    return {
      status: 200,
      payload: {
        ...page,
        items: resultNumbers.numbered([...queued, ...page.items]).map(listed),
      },
    };
  });

  // One item in full, as Details shows it: the gallery's pages leave out its prompt's thinking.
  directRoute(app, "GET", "/api/gallery/items/:id", (account, { params }) => {
    const [item] = filterVisibleGallery([galleryItem(params.id)].filter(Boolean));
    return item && recordBelongsToAccount(item, account)
      ? { status: 200, payload: { item: resultNumbers.numbered([item])[0] } }
      : { status: 404, payload: { error: "That item is no longer in the gallery." } };
  });

  // The result an account's number names ("#12"), as chats refer to it.
  directRoute(app, "GET", "/api/results/:number", (account, { params }) => {
    const found = /^\d{1,9}$/.test(params.number)
      ? resultNumbers.find(account?.userId || "", Number(params.number))
      : null;
    return found
      ? { status: 200, payload: found }
      : { status: 404, payload: { error: `There is no result #${params.number}.` } };
  });
}

/** `starred` hears which of the caller's items changed, for the taste profile. */
export function registerGalleryHistoryRoutes(app, { starred = () => {} } = {}) {
  // A selection is posted, as it may be too long for a URL, and downloads through a short-lived
  // link that only its own account can open.
  const selections = new Map();
  const selectionLife = 10 * 60 * 1000;
  app.post("/api/gallery/export", (req, res) => {
    const now = Date.now();
    for (const [token, entry] of selections) if (entry.expires < now) selections.delete(token);
    const ids = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String));
    if (!ids.size) return res.status(400).json({ error: "Select something to download." });
    const token = crypto.randomUUID();
    selections.set(token, { ids, ownerId: ownerIdForRequest(req), expires: now + selectionLife });
    res.json({ href: `/api/gallery/export?selection=${token}` });
  });
  app.get("/api/gallery/export", (req, res) => {
    let ids = null;
    if (req.query.selection) {
      const entry = selections.get(String(req.query.selection));
      if (!entry || entry.expires < Date.now() || entry.ownerId !== ownerIdForRequest(req))
        return res.status(404).json({ error: "This download has expired. Download again." });
      ids = entry.ids;
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportFilename(ids ? "selection" : "gallery", "zip")}"`,
    );
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    sendGalleryExport(res, { req, ids });
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
function deleteRequested(req, ids, deleted) {
  const wanted = new Set(ids.map(String));
  const removed = recordsForRequest(gallery, req).filter(
    (item) => wanted.has(item.id) || wanted.has(item.url),
  );
  const files = removeGalleryItems(removed);
  deleted(req, removed);
  const matched = new Set(removed.flatMap((item) => [item.id, item.url]));
  return { files, removed: [...wanted].filter((id) => matched.has(id)) };
}

/** The visible gallery items each account owns, by owner ID. */
function ownedGalleries() {
  const owned = new Map();
  for (const item of visibleGallery()) {
    if (!item.ownerId) continue;
    if (!owned.has(item.ownerId)) owned.set(item.ownerId, []);
    owned.get(item.ownerId).push(item);
  }
  return owned;
}

const usageDays = 30;
/** The bytes an account's items take on disk: each saved file and its upscale. */
async function storedBytes(items) {
  const files = items.flatMap((item) => [
    ...outputFileCandidates(item),
    ...(item.upscale?.url ? outputFileCandidates({ url: item.upscale.url }) : []),
  ]);
  const sizes = await Promise.all(
    files.map((file) =>
      fs.promises.stat(file).then(
        (stat) => stat.size,
        () => 0,
      ),
    ),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

/** `deleted(req, items)` hears which items a person deleted from their own gallery. */
export function registerGalleryDeleteRoute(app, { deleted = () => {} } = {}) {
  // Administrators only (Settings › Users): each account's gallery size, its last 30 days' usage
  // and storage, and deleting all of one account's items through the owner's own delete path.
  directRoute(app, "GET", "/api/gallery/owners", async (account) => {
    const refusal = adminRefusal(account);
    if (refusal) return refusal;
    const since = Date.now() - usageDays * 86_400_000;
    const owners = await Promise.all(
      [...ownedGalleries()].map(async ([owner, items]) => {
        const recent = items.filter((item) => Date.parse(item.createdAt || "") >= since);
        const { images, videos, cloudJobs, gpuMs } = galleryStats(recent);
        const bytes = await storedBytes(items);
        return [owner, { items: items.length, images, videos, cloudJobs, gpuMs, bytes }];
      }),
    );
    return { status: 200, payload: { ok: true, owners: Object.fromEntries(owners) } };
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
      payload: { ok: true, ...deleteRequested({ studioAccount: account }, ids, deleted) },
    };
  });
  app.delete("/api/gallery/:id", (req, res) => {
    // Express has already decoded the ID once; a finished item's ID is its URL, which keeps its own escapes.
    const id = req.params.id;
    const { files, removed } = deleteRequested(req, [id], deleted);
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
