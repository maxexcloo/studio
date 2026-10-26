import type { MediaItem } from "../../types";
import type { DreamItem } from "./queries";

export type DeckCard =
  | { kind: "dream"; key: string; item: DreamItem }
  | { kind: "calibration"; key: string; item: MediaItem }
  | { kind: "pair"; key: string; items: [MediaItem, MediaItem] };

/**
 * The next `depth` cards. Every fourth card is a gallery image for calibration (all of them once
 * Dream has nothing unseen), and every third calibration card is a this-or-that pair. Counting
 * from what was judged keeps the order steady as cards leave the deck.
 */
export function deckCards(
  dream: DreamItem[],
  calibration: MediaItem[],
  { judged, calibrated }: { judged: number; calibrated: number },
  depth = 3,
) {
  const unseen = [...dream];
  const gallery = [...calibration];
  const cards: DeckCard[] = [];
  for (let slot = judged, count = calibrated; cards.length < depth; slot++) {
    if (gallery.length && (!unseen.length || slot % 4 === 3)) {
      if (count++ % 3 === 2 && gallery.length >= 2) {
        const items = gallery.splice(0, 2) as [MediaItem, MediaItem];
        cards.push({ kind: "pair", key: `${items[0].id}+${items[1].id}`, items });
      } else {
        const item = gallery.shift()!;
        cards.push({ kind: "calibration", key: item.id, item });
      }
    } else if (unseen.length) {
      const item = unseen.shift()!;
      cards.push({ kind: "dream", key: item.id, item });
    } else break;
  }
  return cards;
}
