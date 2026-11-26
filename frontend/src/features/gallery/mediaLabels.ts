import { isComparisonSet } from "../../../../shared/compare";
import { promptWords } from "../../../../shared/titles";
import type { MediaItem, Profile } from "../../types";
import { dateFormat } from "../../ui/dates";
import { isProfile, profileName, shownProfileName } from "../generation/payload";

/** The label of the compare variant an item is ("Seed 583061750"), which names what sets it apart. */
export const comparisonVariant = ({ resultSet }: Pick<MediaItem, "resultSet">) =>
  isComparisonSet(resultSet) ? resultSet?.variation : undefined;

/**
 * An item's title, for every place one shows (tiles, runs, the viewer, accessible names): the title
 * a chat gave it in its result set, else the text model's, else the prompt's first clause until
 * that is written; an upload without one shows its file name. A compare variant's label is not a
 * title (`comparisonVariant`).
 */
export function mediaTitle(
  item: Pick<MediaItem, "prompt" | "title" | "resultSet" | "uploaded" | "filename">,
) {
  return (
    (comparisonVariant(item) ? undefined : item.resultSet?.variation) ||
    item.title ||
    promptWords(item.prompt) ||
    (item.uploaded ? item.filename || "Upload" : "Untitled Generation")
  );
}

const shortDate = dateFormat({ day: "numeric", month: "short" });
const otherYear = dateFormat({ day: "numeric", month: "short", year: "numeric" });
const timeOnly = dateFormat({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function mediaTimestamp(item: Pick<MediaItem, "createdAt" | "galleryAt">, now = new Date()) {
  const value = item.galleryAt || item.createdAt;
  const date = value && new Date(value);
  if (!date || Number.isNaN(date.getTime())) return;
  const day =
    date.toDateString() === now.toDateString()
      ? "Today"
      : (date.getFullYear() === now.getFullYear() ? shortDate : otherYear).format(date);
  const time = timeOnly.format(date);
  return { value, time, day, label: `${time}, ${day}` };
}

const modelFile = (value: unknown) =>
  String(value || "")
    .split(/[\\/]/)
    .at(-1)!
    .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, "");

/** The saved profile name or an unambiguous catalogue match for older generations. */
export function mediaProfileName(item: MediaItem, profiles: Profile[]) {
  const { profileName: saved, profileId, modelName, model } = item.settings ?? {};
  if (saved) return shownProfileName(String(saved));
  const exact = profiles.find((profile) => isProfile(profile, profileId || item.model));
  if (exact) return profileName(exact);
  const files = new Set([modelName, model, item.model].map(modelFile).filter(Boolean));
  if (!files.size) return "";
  const names = new Set(
    profiles
      .filter(
        (profile) =>
          profile.kind === item.type &&
          [
            profile,
            ...(profile.backendOptions?.flatMap(({ profile }) => (profile ? [profile] : [])) ?? []),
          ].some(
            ({ model, baseModel }) =>
              files.has(modelFile(model)) || files.has(modelFile(baseModel)),
          ),
      )
      .map(profileName),
  );
  return names.size === 1 ? [...names][0] : "";
}

/** Its model and steps, as the viewer header and Details › Model name them. */
export function modelSummary(item: MediaItem, profiles: Profile[]) {
  const model = mediaProfileName(item, profiles);
  const steps = Number(item.settings?.steps);
  // Some profile names already say their steps (Turbo 8 Steps).
  const stepLabel = steps > 0 && !/\b\d+\s+steps?\b/i.test(model) ? `${steps} Steps` : "";
  return [model, stepLabel].filter(Boolean).join(" · ");
}

/** Its profile name and the duration for videos. */
export function mediaDetail(item: MediaItem, profiles: Profile[]) {
  const settings = item.settings || {};
  const name = mediaProfileName(item, profiles);
  const seconds =
    Number(settings.duration) || Number(settings.frames) / Number(settings.fps) || undefined;
  const duration = item.type === "video" && seconds ? `${Math.round(seconds * 10) / 10} s` : "";
  return [name, duration].filter(Boolean).join(" · ");
}

/** The local day an item was made, as `YYYY-MM-DD`, or "" when it has no date. */
export function mediaDay(item: Pick<MediaItem, "createdAt" | "galleryAt">) {
  const time = item.galleryAt || item.createdAt;
  const created = time ? new Date(time) : null;
  if (!created || Number.isNaN(created.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}`;
}

const thisYear = dateFormat({
  weekday: "short",
  day: "numeric",
  month: "short",
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
