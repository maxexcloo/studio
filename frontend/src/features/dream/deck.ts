import { dreamSet } from "../../../../shared/dream.ts";
import type { MediaItem } from "../../types";
import type { DreamItem, DreamMedia } from "./queries";

/**
 * A Dream comparison asks about results alike except for the difference the labels name.
 */
export type PairDeckCard = {
  kind: "pair";
  key: string;
  items: DreamItem[];
  question: string;
  pairId: string;
  labels?: string[];
};
type SetDeckCard = {
  kind: "set";
  key: string;
  setId: string;
  title: string;
  item: DreamItem;
  items: DreamItem[];
};
export type MultiDeckCard = PairDeckCard | SetDeckCard;
export type DeckCard =
  | { kind: "dream"; key: string; item: DreamItem }
  | { kind: "library"; key: string; item: MediaItem }
  | MultiDeckCard;

/** A set's first available result is its cover. */
function seriesCards(dream: DreamItem[]) {
  const sets = new Map<string, DreamItem[]>();
  for (const item of dream) {
    const set = dreamSet(item);
    if (!set) continue;
    const list = sets.get(set.id);
    if (list) list.push(item);
    else sets.set(set.id, [item]);
  }
  for (const items of sets.values()) items.sort((a, b) => dreamSet(a)!.index - dreamSet(b)!.index);
  return sets;
}

function dreamCards(dream: DreamItem[], limit: number): DeckCard[] {
  const cards: DeckCard[] = [];
  const comparisons = new Map<string, DreamItem[]>();
  for (const item of dream) {
    const pair = item.dream?.pair;
    if (!pair) continue;
    const members = comparisons.get(pair.id);
    if (members) members.push(item);
    else comparisons.set(pair.id, [item]);
  }
  const emitted = new Set<string>();
  const sets = seriesCards(dream);
  for (const item of dream) {
    if (cards.length >= limit) break;
    const set = dreamSet(item);
    if (set) {
      const members = sets.get(set.id);
      if (!members) continue;
      sets.delete(set.id);
      if (members.length > 1) {
        cards.push({
          kind: "set",
          key: `set:${set.id}`,
          setId: set.id,
          title: set.title,
          item: members[0],
          items: members,
        });
        continue;
      }
    }
    const pair = item.dream?.pair;
    if (pair && emitted.has(pair.id)) continue;
    const members = pair && comparisons.get(pair.id)!;
    const size = pair?.size ?? 2;
    if (pair && members && members.length === size) {
      members.sort((a, b) => a.dream!.pair!.side - b.dream!.pair!.side);
      if (
        members.every(
          ({ dream }, index) => dream!.pair!.side === index && (dream!.pair!.size ?? 2) === size,
        )
      ) {
        emitted.add(pair.id);
        cards.push({
          kind: "pair",
          key: pair.id,
          items: members,
          question: pair.question,
          pairId: pair.id,
          labels: members.map((entry) => entry.dream!.pair!.label),
        });
        continue;
      }
    }
    cards.push({ kind: "dream", key: item.id, item });
  }
  return cards;
}

export const cardIds = (card: DeckCard) =>
  (card.kind === "pair" || card.kind === "set" ? card.items : [card.item]).map((item) => item.id);

/** Newest unseen Dream results first, keeping genuine comparisons and the active card together. */
export function deckCards(
  dream: DreamItem[],
  {
    depth = 3,
    media = "image",
    current,
  }: { depth?: number; media?: DreamMedia; current?: DeckCard } = {},
) {
  const streamed = dream.filter((item) => item.type === media);
  const active =
    current &&
    current.kind !== "library" &&
    cardIds(current).every((id) => streamed.some((item) => item.id === id))
      ? current
      : undefined;
  const activeIds = new Set(active ? cardIds(active) : []);
  const unseen = dreamCards(
    streamed
      .filter((item) => !activeIds.has(item.id))
      .sort((a, b) =>
        String(b.createdAt || b.dream?.at || "").localeCompare(
          String(a.createdAt || a.dream?.at || ""),
        ),
      ),
    depth - (active ? 1 : 0),
  );
  return active && depth > 0 ? [active, ...unseen] : unseen;
}
