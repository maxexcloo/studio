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

/** Dream's comparisons as cards: both sides of each make one pair card. */
function dreamCards(dream: DreamItem[]): DeckCard[] {
  const cards: DeckCard[] = [];
  const paired = new Set<string>();
  for (const item of dream) {
    const pair = item.dream?.pair;
    if (!pair || paired.has(pair.id)) continue;
    const other = dream.find((entry) => entry !== item && entry.dream?.pair?.id === pair.id);
    if (!other) continue;
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

/**
 * The next `depth` cards: Dream's own unseen results always come first; gallery images for
 * calibration follow only once Dream has nothing unseen, every third one a this-or-that pair.
 * Counting from what was calibrated keeps the order steady as cards leave the deck.
 */
export function deckCards(
  dream: DreamItem[],
  calibration: MediaItem[],
  { calibrated }: { calibrated: number },
  depth = 3,
) {
  const unseen = dreamCards(dream);
  const gallery = [...calibration];
  const cards: DeckCard[] = [];
  for (let count = calibrated; cards.length < depth;) {
    if (gallery.length && !unseen.length) {
      if (count++ % 3 === 2 && gallery.length >= 2) {
        const items = gallery.splice(0, 2) as [MediaItem, MediaItem];
        cards.push({
          kind: "pair",
          key: `${items[0].id}+${items[1].id}`,
          items,
          question: "Which Image?",
        });
      } else {
        const item = gallery.shift()!;
        cards.push({ kind: "calibration", key: item.id, item });
      }
    } else if (unseen.length) cards.push(unseen.shift()!);
    else break;
  }
  return cards;
}
