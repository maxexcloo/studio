import { promptWords } from "../../../../shared/titles";
import type { MediaItem, Profile } from "../../types";
import { isProfile } from "../generation/payload";

/**
 * An item's title, for every place one shows (tiles, runs, the viewer, accessible names): the text
 * model's title, else the prompt's first clause until it is written.
 */
export function mediaTitle(item: Pick<MediaItem, "prompt" | "title">) {
  return item.title || promptWords(item.prompt) || "Untitled Generation";
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
// Made once: `toLocaleString` with options builds a formatter on every call, once per tile render.
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayAndTime = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** When it was made · the profile's name, plus a video's length. */
export function mediaDetail(item: MediaItem, profiles: Profile[]) {
  const settings = item.settings || {};
  const created = item.createdAt ? new Date(item.createdAt) : null;
  const time =
    created && !Number.isNaN(created.getTime())
      ? (sameDay(created, new Date()) ? timeOnly : dayAndTime).format(created)
      : "";
  const profile = profiles.find((entry) => isProfile(entry, settings.profileId));
  const name = String(settings.profileName || profile?.displayName || profile?.label || "");
  const seconds =
    Number(settings.duration) || Number(settings.frames) / Number(settings.fps) || undefined;
  const duration = item.type === "video" && seconds ? `${Math.round(seconds * 10) / 10} s` : "";
  return [time, name, duration].filter(Boolean).join(" · ");
}
