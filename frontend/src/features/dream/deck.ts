import type { MediaItem } from "../../types";
import type { DreamItem } from "./queries";

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
      pair && dream.find((entry) => entry !== item && entry.dream?.pair?.id === pair.id);
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

/** Every fourth card is a this-or-that pair of gallery images, so comparisons keep a steady share. */
const pairEvery = 4;

/**
 * The next `depth` cards after `judged` judged ones: a pair of gallery images every `pairEvery`
 * cards while there are two, Dream's unseen results between them, then single gallery images for
 * calibration once Dream has nothing unseen. Counting from what was judged keeps the order steady
 * as cards leave the deck.
 */
export function deckCards(dream: DreamItem[], calibration: MediaItem[], judged: number, depth = 3) {
  const unseen = dreamCards(dream);
  const gallery = [...calibration];
  const cards: DeckCard[] = [];
  for (let count = judged; cards.length < depth; count++) {
    if (count % pairEvery === pairEvery - 1 && gallery.length >= 2) {
      const items = gallery.splice(0, 2) as [MediaItem, MediaItem];
      cards.push({
        kind: "pair",
        key: `${items[0].id}+${items[1].id}`,
        items,
        question: "Which Image?",
      });
    } else if (unseen.length) cards.push(unseen.shift()!);
    else if (gallery.length) {
      const item = gallery.shift()!;
      cards.push({ kind: "calibration", key: item.id, item });
    } else break;
  }
  return cards;
}
