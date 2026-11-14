import type { MediaItem } from "../../types";
import { mediaTitle } from "./mediaLabels";

/**
 * An MCP generate call's results (`resultSet`): the run Runs groups and the viewer flips through
 * in place of their jobs, newest first as the gallery lists them.
 */
export const runKey = (item: MediaItem) => item.resultSet?.id || item.jobId;

// Work without a time yet is the newest.
const setOrder = (a: MediaItem, b: MediaItem) =>
  (b.createdAt || "~").localeCompare(a.createdAt || "~") || (a.index ?? 0) - (b.index ?? 0);

/** The loaded results of `item`'s set, `item` included, in the set's order; none outside a set. */
export function setMembers(items: MediaItem[], item: MediaItem) {
  const id = item.resultSet?.id;
  if (!id) return [];
  const members = items.filter((candidate) => candidate.resultSet?.id === id);
  if (!members.some((member) => member.id === item.id)) members.push(item);
  return members.sort(setOrder);
}

/** Items of one run in the set's order, or as given outside a set. */
export const inRunOrder = (items: MediaItem[]) =>
  items[0]?.resultSet ? [...items].sort(setOrder) : items;

/** "Variety Test › Fox Wizard (3 of 5)": the set, the result's own title and its place. */
export function setPosition(item: MediaItem, members: MediaItem[]) {
  const position = members.findIndex((member) => member.id === item.id) + 1;
  return `${item.resultSet!.title} › ${mediaTitle(item)} (${position} of ${members.length})`;
}
