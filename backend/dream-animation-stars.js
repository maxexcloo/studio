import { dreamState, galleryKey, writeGalleryRows } from "./persistence/gallery-rows.ts";
import { runtimeDatabase } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that takes back the stars Dream's own videos gave the results they
 * animated. From v2026.11.10 until Dream's video jobs stopped starring their source photo, each
 * Dream video starred its source image, so Dream's Liked (and unseen) results it animated read as
 * Super Liked. A Dream result is unstarred where a Dream video since then animated it, unless the
 * account's taste history shows a star of it at another moment (a Super Like or Star by the
 * person). One that was still unseen, and so kept by that star, returns to Dream's unseen pool.
 * Other images Dream animated were already starred and stay so. Plans by default;
 * `apply` writes. A second run finds nothing.
 */
const since = "2026-11-10T00:00:00.000Z";
/** How far a star may lie from a Dream video's queueing and still be that video's. */
const sameMoment = 60_000;

const sourceKey = (video) => {
  const id = String(video.settings?.referenceAssets?.[0]?.assetId || "");
  return id.startsWith("gallery:") ? Buffer.from(id.slice(8), "base64url").toString("utf8") : id;
};
const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= sameMoment;

/** The starred Dream results whose star came from a Dream video animating them. */
export function dreamAnimationStarred(items, signals = () => []) {
  const byKey = new Map(items.map((item) => [galleryKey(item), item]));
  const animated = new Map();
  for (const video of items) {
    if (video.type !== "video" || !video.dream || (video.dream.at || "") < since) continue;
    const photo = byKey.get(sourceKey(video));
    if (
      photo?.type !== "image" ||
      !photo.favorite ||
      !photo.dream ||
      photo.ownerId !== video.ownerId
    )
      continue;
    animated.set(photo, [...(animated.get(photo) || []), video.dream.at]);
  }
  return [...animated].flatMap(([photo, times]) => {
    const deliberate = signals(photo.ownerId).some(
      (signal) =>
        signal.kind === "star" &&
        signal.jobId === photo.jobId &&
        (!signal.itemId || signal.itemId === photo.id) &&
        !times.some((at) => near(signal.at, at)),
    );
    if (deliberate) return [];
    // An unseen result was kept by the star itself, at the moment Dream queued its video.
    const keptByStar =
      photo.dream.state === "kept" && times.some((at) => near(photo.dream.decidedAt, at));
    return [{ photo, keptByStar }];
  });
}

export function dreamAnimationStars(dataDir, { apply = false } = {}) {
  const db = runtimeDatabase(dataDir);
  const items = db
    .prepare(`SELECT value FROM studio_gallery WHERE ${dreamState} IS NOT NULL`)
    .all()
    .map((row) => JSON.parse(row.value));
  const read = db.prepare("SELECT value FROM studio_documents WHERE name = ?");
  const taste = new Map();
  const signals = (ownerId) => {
    if (!taste.has(ownerId)) {
      const row = read.get(`taste:${ownerId}`);
      taste.set(ownerId, row ? JSON.parse(row.value).signals || [] : []);
    }
    return taste.get(ownerId);
  };
  const plan = dreamAnimationStarred(items, signals);
  const owners = {};
  for (const { photo, keptByStar } of plan) {
    const owner = (owners[photo.ownerId || ""] ||= { stars: 0, keptByStar: 0, examples: [] });
    owner.stars += 1;
    if (keptByStar) owner.keptByStar += 1;
    if (owner.examples.length < 5)
      owner.examples.push({ id: photo.id, title: photo.title, keptAt: photo.dream.decidedAt });
  }
  if (apply && plan.length)
    writeGalleryRows(
      db,
      plan.map(({ photo: { favorite: _favorite, ...rest }, keptByStar }) => {
        if (!keptByStar) return rest;
        const { decidedAt: _decidedAt, ...dream } = rest.dream;
        return { ...rest, dream: { ...dream, state: "unseen" } };
      }),
    );
  return { applied: apply, stars: plan.length, owners };
}
