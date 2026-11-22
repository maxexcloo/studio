import type { MediaItem } from "../../types";
import { mediaTitle } from "./mediaLabels";

// Work without a time yet is the newest.
const setOrder = (a: MediaItem, b: MediaItem) =>
  (b.galleryAt || b.createdAt || "~").localeCompare(a.galleryAt || a.createdAt || "~") ||
  (a.index ?? 0) - (b.index ?? 0);

/** The loaded results of `item`'s set, `item` included, in the set's order; none outside a set. */
export function setMembers(items: MediaItem[], item: MediaItem) {
  const id = item.resultSet?.id;
  if (!id) return [];
  const members = items.filter((candidate) => candidate.resultSet?.id === id);
  if (!members.some((member) => member.id === item.id)) members.push(item);
  return members.sort(setOrder);
}

/** "Fox Wizard · 3 / 5": the result's title and its place; Details holds the set's name. */
export function setPosition(item: MediaItem, members: MediaItem[]) {
  const position = members.findIndex((member) => member.id === item.id) + 1;
  return `${mediaTitle(item)} · ${position} / ${members.length}`;
}
