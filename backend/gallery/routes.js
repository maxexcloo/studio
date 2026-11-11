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
  visibleGallery,
} from "./store.js";
import fs from "node:fs";
import { galleryFilter, outputFileCandidates, setGalleryFavorites } from "./store.js";
import { galleryTime } from "./order.js";
import { makePendingItems } from "./records.js";
import { exportFilename, sendGalleryExport } from "./export.js";
import { recordBelongsToAccount, recordsForRequest } from "../account-ownership.js";
import { galleryAspects, gallerySizeBands, topCaptionTags } from "./filters.js";
import { canonicalProfileId } from "../profile/store.js";
import { directRoute } from "../domain/direct-route.ts";
import { queuePriority } from "../domain/store.ts";
import { adminRefusal } from "../route-access.js";
import { galleryKey } from "../persistence/gallery-rows.ts";
import { galleryStats } from "../stats.js";

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
 * `near(q)` resolves to a test for items that look like the search (domain/image-search.ts), or null; `similar(item)` scores items
 * by how alike they look to it, or is null when it can't.
 */
export function registerGalleryReadRoutes(app, { near, similar, store }) {
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
        Object.entries(query).filter(([key]) => key !== "cursor" && key !== "limit"),
      ]),
      filter: (item) =>
        recordBelongsToAccount(item, account) &&
        // `set` keeps one MCP result set's results.
        (!query.set || item.resultSet?.id === query.set) &&
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
    // Work the queue holds has no tiles until it starts; the first page leads with them, so all of
    // the account's unfinished work shows. Dream's stays in its own pool; an upscale has no tile.
    const queued =
      cursor || similarTo || query.uploads === "1"
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
                (!search || search(item)),
            );
    return {
      status: 200,
      payload: {
        ...page,
        items: [...queued, ...page.items].map(listed),
      },
    };
  });

  // One item in full, as Details shows it: the gallery's pages leave out its prompt's thinking.
  directRoute(app, "GET", "/api/gallery/items/:id", (account, { params }) => {
    const [item] = filterVisibleGallery([galleryItem(params.id)].filter(Boolean));
    return item && recordBelongsToAccount(item, account)
      ? { status: 200, payload: { item } }
      : { status: 404, payload: { error: "That item is no longer in the gallery." } };
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

export function registerGalleryDeleteRoute(app) {
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
