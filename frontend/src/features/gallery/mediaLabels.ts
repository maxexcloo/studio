import type { MediaItem, Profile } from "../../types";
import { isProfile } from "../generation/payload";

/** A short title from the prompt's first clause, for captions and accessible names. */
export function mediaTitle(item: Pick<MediaItem, "prompt">) {
  const plain = (item.prompt || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[()[\]{}]/g, "")
    .replace(/:\s*-?\d+(\.\d+)?/g, "")
    .trim();
  const line = plain.split(/[,.;|\n]/)[0].trim() || plain;
  const text = line.length > 64 ? `${line.slice(0, 61).replace(/\s+\S*$/, "")}…` : line;
  return text ? text[0].toUpperCase() + text.slice(1) : "Untitled Generation";
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** When it was made · the profile's name, plus a video's length. */
export function mediaDetail(item: MediaItem, profiles: Profile[]) {
  const settings = item.settings || {};
  const created = item.createdAt ? new Date(item.createdAt) : null;
  const time =
    created && !Number.isNaN(created.getTime())
      ? created.toLocaleString(
          undefined,
          sameDay(created, new Date())
            ? { hour: "numeric", minute: "2-digit" }
            : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" },
        )
      : "";
  const profile = profiles.find((entry) => isProfile(entry, settings.profileId));
  const name = String(settings.profileName || profile?.displayName || profile?.label || "");
  const seconds =
    Number(settings.duration) || Number(settings.frames) / Number(settings.fps) || undefined;
  const duration = item.type === "video" && seconds ? `${Math.round(seconds * 10) / 10} s` : "";
  return [time, name, duration].filter(Boolean).join(" · ");
}
