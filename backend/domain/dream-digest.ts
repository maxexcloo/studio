import type { DreamDigest, DreamDigestRow, DreamPassReason } from "../../shared/dream.ts";
import type { Project } from "../../shared/projects.ts";
import type { DreamItem } from "./dream.ts";
import type { TasteRecord } from "./taste.ts";

const weekMs = 7 * 86_400_000;
const rows = 5;
const topResults = 12;

/**
 * Dream › This Week for an account, read from its Dream records and taste without calling a model,
 * and kept for `cacheMs` so reopening the view reads nothing again.
 */
export function createDreamDigest({
  decided,
  taste,
  projects,
  exploring,
  profiles,
  loraName,
  now = Date.now,
  cacheMs = 60_000,
}: {
  /** The owner's kept and passed Dream results decided since then, Dream's pool included. */
  decided(ownerId: string, since: string): DreamItem[];
  taste(ownerId: string): Pick<TasteRecord, "models" | "loras" | "tags">;
  projects(ownerId: string): Project[];
  /** The share of Dream's ideas that explore, from 0 to 1. */
  exploring(ownerId: string): number;
  /** Every profile's readable name, by id. */
  profiles(): Promise<{ id: string; label?: string }[]>;
  loraName(name: string): string;
  now?: () => number;
  cacheMs?: number;
}) {
  const cache = new Map<string, { until: number; digest: DreamDigest<DreamItem> }>();
  async function read(ownerId: string): Promise<DreamDigest<DreamItem>> {
    const labels = new Map((await profiles()).map((profile) => [profile.id, profile.label]));
    const profileName = (id: string) => labels.get(id) || id;
    const since = new Date(now() - weekMs).toISOString();
    const items = decided(ownerId, since);
    const kept = items.filter((item) => item.dream?.state === "kept");
    const passed = items.filter((item) => item.dream?.state === "discarded");
    const tally = (names: (item: DreamItem) => string[]) => {
      const counts = new Map<string, DreamDigestRow>();
      for (const item of items)
        for (const name of new Set(names(item))) {
          const row = counts.get(name) || { name, kept: 0, passed: 0 };
          row[item.dream?.state === "kept" ? "kept" : "passed"]++;
          counts.set(name, row);
        }
      return [...counts.values()];
    };
    // Kept and passed each start at one, so two verdicts don't outrank twenty.
    const rate = (row: DreamDigestRow) => (row.kept + 1) / (row.kept + row.passed + 2);
    const best = (all: DreamDigestRow[]) =>
      all
        .filter((row) => row.kept && row.kept + row.passed >= 2)
        .sort((a, b) => rate(b) - rate(a) || b.kept - a.kept || a.name.localeCompare(b.name))
        .slice(0, rows);
    const loras = (item: DreamItem) =>
      ((item.settings?.loras as (string | { name?: string; enabled?: boolean })[]) || []).flatMap(
        (lora) =>
          typeof lora === "string"
            ? [loraName(lora)]
            : lora?.name && lora.enabled !== false
              ? [loraName(lora.name)]
              : [],
      );
    const themes = tally((item) => {
      const tags = (item.caption as { tags?: unknown } | undefined)?.tags;
      return Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
    });
    const reasons = new Map<DreamPassReason, number>();
    for (const item of passed) {
      const reason = item.dream?.passReason ?? "skip";
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
    const score = (item: DreamItem) => [
      Number(Boolean(item.dream?.superLiked)),
      Number(item.rating === "liked"),
      item.review?.score ?? 0,
      Date.parse(item.dream?.decidedAt || "") || 0,
    ];
    const ranked = (a: DreamItem, b: DreamItem) => {
      const [x, y] = [score(a), score(b)];
      return y.map((value, index) => value - x[index]).find(Boolean) ?? 0;
    };
    const record = taste(ownerId);
    return {
      kept: kept.length,
      passed: passed.length,
      top: kept.sort(ranked).slice(0, topResults),
      best: {
        models: best(
          tally((item) => {
            const id = String(item.settings?.profileId || "");
            return id ? [profileName(id)] : [];
          }),
        ),
        loras: best(tally(loras)),
        themes: best(themes),
      },
      passedThemes: themes
        .filter((row) => row.passed)
        .sort((a, b) => b.passed - a.passed || a.name.localeCompare(b.name))
        .slice(0, rows),
      reasons: [...reasons]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
      next: {
        models: record.models.slice(0, 3).map(profileName),
        loras: record.loras.slice(0, 3).map(loraName),
        themes: record.tags.slice(0, 5),
        projects: projects(ownerId)
          .filter((project) => !project.paused)
          .sort((a, b) => Number(Boolean(b.favoured)) - Number(Boolean(a.favoured)))
          .map((project) => project.name),
        explore: exploring(ownerId),
      },
    };
  }
  return async (ownerId: string) => {
    const cached = cache.get(ownerId);
    if (cached && cached.until > now()) return cached.digest;
    const digest = await read(ownerId);
    cache.set(ownerId, { until: now() + cacheMs, digest });
    return digest;
  };
}
export type DreamDigestReader = ReturnType<typeof createDreamDigest>;
