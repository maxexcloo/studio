import { type Card, type CardKind, compareCardLikes } from "../../../../shared/characters";
import { gallerySortLabels } from "../../../../shared/gallery-sort";
import { compareNames } from "../../ui/DataTable";
import { useRemembered } from "../auth/useRemembered";

export const cardSortLabels = {
  ...gallerySortLabels,
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
};
export type CardSort = keyof typeof cardSortLabels;

type CardListing = { sort?: CardSort };
const listingsDefault: Partial<Record<CardKind, CardListing>> = {};

export function useCardListing(surface: "library" | "references", kind: CardKind) {
  const [listings, setListings] = useRemembered(`card-listing:${surface}`, listingsDefault);
  return {
    sort: listings[kind]?.sort ?? (surface === "references" ? "liked" : "newest"),
    setSort: (sort: CardSort) => setListings((previous) => ({ ...previous, [kind]: { sort } })),
  };
}

export function listedCards<T extends Pick<Card, "name" | "description" | "createdAt" | "rating">>(
  cards: T[] | undefined,
  query: string,
  sort: CardSort,
) {
  const words = query.trim().toLocaleLowerCase();
  // Records are stored in creation order, which also breaks ties between identical timestamps.
  const matches = (cards ?? []).filter(
    (card) =>
      (sort === "disliked" || card.rating !== "disliked") &&
      (!words || `${card.name} ${card.description}`.toLocaleLowerCase().includes(words)),
  );
  const newest = (a: T, b: T) => (b.createdAt || "").localeCompare(a.createdAt || "");
  if (sort !== "oldest") matches.reverse();
  switch (sort) {
    case "name-asc":
      return matches.sort((a, b) => compareNames(a.name, b.name));
    case "name-desc":
      return matches.sort((a, b) => compareNames(b.name, a.name));
    case "liked":
      return matches.sort((a, b) => compareCardLikes(a, b) || newest(a, b));
    case "disliked":
      return matches.sort(
        (a, b) => Number(b.rating === "disliked") - Number(a.rating === "disliked") || newest(a, b),
      );
    case "oldest":
      return matches.sort((a, b) => newest(b, a));
    default:
      return matches.sort(newest);
  }
}
