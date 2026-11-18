import { type RouteAccount, directRoute } from "./direct-route.ts";
import { similarThresholds } from "./image-search.ts";

/** What reflection reads of a gallery item. */
export interface ReflectionItem {
  id: string;
  status?: string;
  rating?: string;
  createdAt?: string;
  url?: string;
  thumbnailUrl?: string;
  title?: string;
  model?: string;
  settings?: { profileId?: string; profileName?: string; modelName?: string };
  dream?: { state?: string };
}
type Likeness = (a: ReflectionItem, b: ReflectionItem) => number | undefined;

/**
 * Sameness compares the newest `window` images with the `window` before them: the share of each
 * window's pairs at least as alike as Find Similar's "similar". Recent results converge when that
 * share reaches `least` and has risen by `rise`, or without an earlier window to compare, reaches
 * `alone`; a window counts once Image Search has read `read` of its images.
 */
const sameness = { window: 40, least: 0.2, rise: 0.1, alone: 0.5, read: 10, examples: 4 };
/** Days of results by model, read up to `items` images. */
const history = { days: 30, items: 5000 };
const keptMs = 5 * 60_000;
const dayMs = 24 * 60 * 60_000;

function alikeShare(items: ReflectionItem[], likeness: Likeness) {
  const read = new Set<ReflectionItem>();
  const partners = new Map<ReflectionItem, number>();
  let pairs = 0;
  let alike = 0;
  for (let first = 0; first < items.length; first += 1)
    for (let second = first + 1; second < items.length; second += 1) {
      const a = items[first];
      const b = items[second];
      const score = likeness(a, b);
      if (score === undefined) continue;
      read.add(a).add(b);
      pairs += 1;
      if (score < similarThresholds.similar) continue;
      alike += 1;
      partners.set(a, (partners.get(a) || 0) + 1);
      partners.set(b, (partners.get(b) || 0) + 1);
    }
  if (read.size < sameness.read) return null;
  const most = [...partners].sort((a, b) => b[1] - a[1]).map(([item]) => item);
  return { share: alike / pairs, most };
}

/** How alike the newest images are against those before, with the most repeated as examples. */
export function samenessOf(items: ReflectionItem[], likeness: Likeness) {
  const recent = alikeShare(items.slice(0, sameness.window), likeness);
  const earlier = alikeShare(items.slice(sameness.window, 2 * sameness.window), likeness);
  const converging = Boolean(
    recent &&
    recent.share >= sameness.least &&
    (earlier ? recent.share - earlier.share >= sameness.rise : recent.share >= sameness.alone),
  );
  return {
    recent: recent?.share ?? null,
    earlier: earlier?.share ?? null,
    converging,
    examples: converging
      ? recent!.most.slice(0, sameness.examples).map((item) => ({
          id: item.id,
          url: item.thumbnailUrl || item.url || "",
          title: item.title || "",
        }))
      : [],
  };
}

/**
 * Per day (in `zone`) and model actually run, in gallery order: finished images, liked and
 * disliked. Dream results count once judged. With `limited`, the oldest day, which the read limit
 * may have cut short, is left out.
 */
export function daysOf(items: ReflectionItem[], zone: string, limited: boolean) {
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone: zone, dateStyle: "short" });
  const finished = items.filter(
    (item) => item.status === "done" && item.createdAt && item.dream?.state !== "unseen",
  );
  const oldest = finished.at(-1)?.createdAt;
  const cut = limited && oldest ? dayOf.format(new Date(oldest)) : "";
  const rows = new Map<
    string,
    {
      day: string;
      profileId: string;
      profileName: string;
      model: string;
      made: number;
      liked: number;
      disliked: number;
    }
  >();
  for (const item of finished) {
    const day = dayOf.format(new Date(item.createdAt!));
    if (day === cut) continue;
    const settings = item.settings || {};
    const profileId = settings.profileId || "";
    // An imported workflow's model is the workflow; the file it loaded is the model run.
    const model = settings.modelName || (item.model?.startsWith("custom:") ? "" : item.model) || "";
    const key = JSON.stringify([day, profileId, model]);
    const row = rows.get(key) || {
      day,
      profileId,
      profileName: settings.profileName || "",
      model,
      made: 0,
      liked: 0,
      disliked: 0,
    };
    row.made += 1;
    if (item.rating === "liked") row.liked += 1;
    if (item.rating === "disliked") row.disliked += 1;
    rows.set(key, row);
  }
  return [...rows.values()];
}

/**
 * Reflection on an account's own images: whether recent results and likes are converging on one
 * look, and how each model has fared day by day. Each is kept per owner for a few minutes.
 */
export function createReflection(options: {
  gallery(ownerId: string, query: Record<string, unknown>): ReflectionItem[];
  likeness: Likeness;
  now?: () => number;
}) {
  const now = options.now || Date.now;
  const kept = new Map<string, { at: number; value: unknown }>();
  const cached = <T>(key: unknown[], build: () => T): T => {
    const name = JSON.stringify(key);
    const found = kept.get(name);
    if (found && now() - found.at < keptMs) return found.value as T;
    kept.delete(name);
    if (kept.size >= 100) kept.delete(kept.keys().next().value!);
    const value = build();
    kept.set(name, { at: now(), value });
    return value;
  };
  const images = { type: "image", status: "done", limit: 2 * sameness.window };
  const samenessFor = (ownerId: string) =>
    cached(["sameness", ownerId], () => ({
      made: samenessOf(
        options.gallery(ownerId, { ...images, uploaded: false, unlisted: false }),
        options.likeness,
      ),
      liked: samenessOf(options.gallery(ownerId, { ...images, rating: "liked" }), options.likeness),
    }));
  return {
    sameness: samenessFor,
    read: (ownerId: string, zone: string) => ({
      sameness: samenessFor(ownerId),
      days: cached(["days", ownerId, zone], () => {
        const items = options.gallery(ownerId, {
          type: "image",
          uploaded: false,
          since: now() - history.days * dayMs,
          limit: history.items,
        });
        return daysOf(items, zone, items.length === history.items);
      }),
    }),
  };
}
export type Reflection = ReturnType<typeof createReflection>;

/** The caller's own reflection; days follow `zone`, the browser's time zone. */
export function registerReflectionRoutes(app: object, { reflection }: { reflection: Reflection }) {
  directRoute(app, "GET", "/api/taste/reflection", (account: RouteAccount, { query }) => {
    const zone = typeof query.zone === "string" && query.zone ? query.zone : "UTC";
    if (zone !== "UTC" && !Intl.supportedValuesOf("timeZone").includes(zone))
      return { status: 400, payload: { ok: false, error: "Supply a valid time zone." } };
    return { status: 200, payload: reflection.read(account?.userId || "", zone) };
  });
}
