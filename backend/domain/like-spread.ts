import { readRuntimeDocument, writeRuntimeDocument } from "../persistence/runtime.ts";

/** What a liked item was drawn for. */
type LikePurpose =
  | "animate"
  | "compare"
  | "extend"
  | "prompt"
  | "recreate"
  | "remaster"
  | "seed"
  | "summary";
type Use = { uses: number; last: number };
/** An account's use of its liked items: how often and when (ms) each served each purpose. */
export interface LikeLedger {
  /** Uses so far per purpose; the next draw starts at this age bucket, so buckets take turns. */
  turns: Partial<Record<LikePurpose, number>>;
  items: Record<string, Partial<Record<LikePurpose, Use>>>;
}

const day = 86_400_000;
/** Age buckets by creation, newest first: the last week, month and six months, then older. */
const ageBuckets = [7 * day, 30 * day, 182 * day, Infinity];
/** An item used for a purpose within `ms` weighs `factor` as much for it. */
export const cooldown = { ms: 3 * day, factor: 0.05 };

/** Each age bucket as a gallery range (`since` and `before`, in ms), newest first. */
export const ageRanges = (now: number) =>
  ageBuckets.map((age, index) => ({
    ...(age === Infinity ? {} : { since: now - age }),
    ...(index ? { before: now - ageBuckets[index - 1] - 1 } : {}),
  }));

/** Every age bucket's matches, read through `fetch` with the bucket's range. */
export async function agePools<T>(
  now: number,
  fetch: (range: { since?: number; before?: number }) => T[] | Promise<T[]>,
) {
  return (await Promise.all(ageRanges(now).map(fetch))).flat();
}

const bucketOf = (createdAt: string | undefined, now: number) => {
  const age = now - (Date.parse(createdAt || "") || 0);
  return ageBuckets.findIndex((limit) => age < limit);
};

/** Fewer uses weigh more, and a use within the cooldown weighs much less. */
export const weight = (use: Use | undefined, now: number) =>
  use ? (now - use.last < cooldown.ms ? cooldown.factor : 1) / (1 + use.uses) : 1;

/**
 * The items, once each, in draw order: age buckets take turns from the ledger's turn for the
 * purpose, and each draw within a bucket is weighted by `weight`.
 */
export function spreadOrder<T extends { id?: unknown; createdAt?: string }>(
  items: T[],
  ledger: LikeLedger,
  purpose: LikePurpose,
  now: number,
  random: (size: number) => number,
) {
  const buckets: T[][] = ageBuckets.map(() => []);
  const seen = new Set<string>();
  for (const item of items) {
    const id = item.id === undefined ? "" : String(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    buckets[bucketOf(item.createdAt, now)].push(item);
  }
  const order: T[] = [];
  for (let turn = ledger.turns[purpose] ?? 0; order.length < seen.size; turn++) {
    const bucket = buckets[turn % buckets.length];
    if (bucket.length < 2) {
      order.push(...bucket.splice(0));
      continue;
    }
    const weights = bucket.map((item) => weight(ledger.items[String(item.id)]?.[purpose], now));
    let at = (random(1_000_000) / 1_000_000) * weights.reduce((sum, value) => sum + value, 0);
    const index = weights.findIndex((value) => (at -= value) < 0);
    order.push(bucket.splice(index < 0 ? bucket.length - 1 : index, 1)[0]);
  }
  return order;
}

/** The account's ledger in the runtime data folder, shared by Dream and the taste summary. */
export function likeLedger(dataDir: string, now: () => number = Date.now) {
  const name = (ownerId: string) => `like-usage:${ownerId}`;
  const read = (ownerId: string): LikeLedger => ({
    turns: {},
    items: {},
    ...(readRuntimeDocument(dataDir, name(ownerId)) as Partial<LikeLedger> | undefined),
  });
  return {
    read,
    order: <T extends { id?: unknown; createdAt?: string }>(
      ownerId: string,
      purpose: LikePurpose,
      items: T[],
      random: (size: number) => number,
    ) => spreadOrder(items, read(ownerId), purpose, now(), random),
    /** Records that the items served the purpose. */
    used(ownerId: string, purpose: LikePurpose, ids: unknown[]) {
      if (!ids.length) return;
      const ledger = read(ownerId);
      const at = now();
      for (const id of ids) {
        const entry = (ledger.items[String(id)] ??= {});
        entry[purpose] = { uses: (entry[purpose]?.uses ?? 0) + 1, last: at };
      }
      ledger.turns[purpose] = (ledger.turns[purpose] ?? 0) + 1;
      writeRuntimeDocument(dataDir, name(ownerId), ledger);
    },
  };
}
