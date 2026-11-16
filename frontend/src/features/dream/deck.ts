import type { MediaItem } from "../../types";
import type { DreamItem, DreamMedia } from "./queries";

/**
 * A pair asks its question about two images: a Dream comparison (`pairId`, alike but for the one
 * thing `labels` name) or two gallery images for calibration.
 */
export type PairDeckCard = {
  kind: "pair";
  key: string;
  items: [MediaItem, MediaItem];
  question: string;
  pairId?: string;
  labels?: [string, string];
};
export type DeckCard =
  | { kind: "dream"; key: string; item: DreamItem }
  | { kind: "calibration"; key: string; item: MediaItem }
  | PairDeckCard;

/** The finished Dream results as cards: both sides of a comparison make one pair card. */
function dreamCards(dream: DreamItem[]): DeckCard[] {
  const cards: DeckCard[] = [];
  const paired = new Set<string>();
  for (const item of dream) {
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

/**
 * Newest unseen Dream results come first, with genuine comparisons kept together. The active
 * card stays until judged; arrivals take the next places. Gallery calibration follows only
 * after unseen Dream results, pairing every fourth card, or every card while Dream is off.
 */
export function deckCards(
  dream: DreamItem[],
  calibration: MediaItem[],
  judged: number,
  {
    depth = 3,
    pairsOnly = false,
    media = "image",
    current,
  }: { depth?: number; pairsOnly?: boolean; media?: DreamMedia; current?: DeckCard } = {},
) {
  const dreamed = pairsOnly ? [] : dream.filter((item) => item.type === media);
  const gallery = calibration.filter((item) => item.type === media);
  const pool =
    current?.kind === "dream" || (current?.kind === "pair" && current.pairId) ? dreamed : gallery;
  const held =
    current && cardIds(current).every((id) => pool.some((item) => item.id === id))
      ? current
      : undefined;
  const heldIds = new Set(held ? cardIds(held) : []);
  const unseen = dreamCards(
    dreamed
      .filter((item) => !heldIds.has(item.id))
      .sort((a, b) =>
        String(b.createdAt || b.dream?.at || "").localeCompare(
          String(a.createdAt || a.dream?.at || ""),
        ),
      ),
  );
  const remaining = gallery.filter((item) => !heldIds.has(item.id));
  const cards: DeckCard[] = held ? [held] : [];
  for (let count = judged + cards.length; cards.length < depth; count++) {
    if (unseen.length) cards.push(unseen.shift()!);
    else if ((pairsOnly || count % 4 === 3) && remaining.length >= 2) {
      const items = remaining.splice(0, 2) as [MediaItem, MediaItem];
      cards.push({
        kind: "pair",
        key: `${items[0].id}+${items[1].id}`,
        items,
        question: media === "video" ? "Which Video?" : "Which Image?",
      });
    } else if (remaining.length && !pairsOnly) {
      const item = remaining.shift()!;
      cards.push({ kind: "calibration", key: item.id, item });
    } else break;
  }
  return cards;
}
