import type { MediaItem } from "../../types";
import { mediaTitle } from "./mediaLabels";

/**
 * An MCP generate call's results (`resultSet`): the run Runs groups and the viewer flips through
 * in place of their jobs, in prompt order, then as made.
 */
export const runKey = (item: MediaItem) => item.resultSet?.id || item.jobId;

const setOrder = (a: MediaItem, b: MediaItem) =>
  (a.resultSet?.index ?? 0) - (b.resultSet?.index ?? 0) ||
  (a.createdAt || "").localeCompare(b.createdAt || "") ||
  (a.index ?? 0) - (b.index ?? 0);

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

/** The first results of the sets before and after `item`'s among `items`, in their order. */
export function neighbourSets(items: MediaItem[], item: MediaItem) {
  const sets = new Map<string, MediaItem>();
  for (const candidate of items)
    if (candidate.resultSet && !sets.has(candidate.resultSet.id))
      sets.set(candidate.resultSet.id, candidate);
  const order = [...sets.values()];
  const at = order.findIndex((first) => first.resultSet!.id === item.resultSet?.id);
  const first = (neighbour?: MediaItem) => neighbour && setMembers(items, neighbour)[0];
  return at < 0 ? {} : { previous: first(order[at - 1]), next: first(order[at + 1]) };
}
