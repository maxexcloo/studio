import { promptWords } from "../../../../shared/titles";
import type { MediaItem, Profile } from "../../types";
import { isProfile, shownProfileName } from "../generation/payload";

/**
 * An item's title, for every place one shows (tiles, runs, the viewer, accessible names): the title
 * a chat gave it in its result set, else the text model's, else the prompt's first clause until
 * that is written.
 */
export function mediaTitle(item: Pick<MediaItem, "prompt" | "title" | "resultSet">) {
  return (
    item.resultSet?.variation || item.title || promptWords(item.prompt) || "Untitled Generation"
  );
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

/** When it was made (unless `withTime` is false) · the profile's name, plus a video's length. */
export function mediaDetail(item: MediaItem, profiles: Profile[], withTime: boolean) {
  const settings = item.settings || {};
  const created = item.createdAt ? new Date(item.createdAt) : null;
  const time =
    withTime && created && !Number.isNaN(created.getTime())
      ? (sameDay(created, new Date()) ? timeOnly : dayAndTime).format(created)
      : "";
  const profile = profiles.find((entry) => isProfile(entry, settings.profileId));
  const name = shownProfileName(
    String(settings.profileName || profile?.displayName || profile?.label || ""),
  );
  const seconds =
    Number(settings.duration) || Number(settings.frames) / Number(settings.fps) || undefined;
  const duration = item.type === "video" && seconds ? `${Math.round(seconds * 10) / 10} s` : "";
  return [time, name, duration].filter(Boolean).join(" · ");
}

/** The local day an item was made, as `YYYY-MM-DD`, or "" when it has no date. */
export function mediaDay(item: Pick<MediaItem, "createdAt">) {
  const created = item.createdAt ? new Date(item.createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}`;
}

const thisYear = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const otherYear = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** A day heading for a `mediaDay` key: Today, Yesterday, then the date. */
export function dayHeading(day: string, now = new Date()) {
  const [year, month, date] = day.split("-").map(Number);
  const shown = new Date(year, month - 1, date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - shown.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return (year === now.getFullYear() ? thisYear : otherYear).format(shown);
}
