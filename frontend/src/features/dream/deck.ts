import type { MediaItem } from "../../types";
import type { DreamItem, DreamMedia } from "./queries";

/**
 * A Dream comparison asks about two results alike except for the difference the labels name.
 */
export type PairDeckCard = {
  kind: "pair";
  key: string;
  items: [DreamItem, DreamItem];
  question: string;
  pairId: string;
  labels?: [string, string];
};
export type DeckCard =
  | { kind: "dream"; key: string; item: DreamItem }
  | { kind: "library"; key: string; item: MediaItem }
  | PairDeckCard;

/** The finished Dream results as cards: both sides of a comparison make one pair card. */
function dreamCards(dream: DreamItem[], limit: number): DeckCard[] {
  const cards: DeckCard[] = [];
  const paired = new Set<string>();
  for (const item of dream) {
    if (cards.length >= limit) break;
    const pair = item.dream?.pair;
    if (pair && paired.has(pair.id)) continue;
    const other =
      pair &&
      dream.find(
        (entry) => entry !== item && entry.type === item.type && entry.dream?.pair?.id === pair.id,
      );
    if (!pair || !other) {
      cards.push({ kind: "dream", key: item.id, item });
      continue;
    }
    paired.add(pair.id);
    const [a, b] = pair.side ? [other, item] : [item, other];
    cards.push({
      kind: "pair",
      key: pair.id,
      items: [a, b],
      question: pair.question,
      pairId: pair.id,
      labels: [a.dream!.pair!.label, b.dream!.pair!.label],
    });
  }
  return cards;
}

export const cardIds = (card: DeckCard) =>
  card.kind === "pair" ? card.items.map((item) => item.id) : [card.item.id];

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
