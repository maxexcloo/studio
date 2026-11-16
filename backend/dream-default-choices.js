import { dreamDefaults } from "../shared/dream.ts";
import { ownerDocuments, savedDocument, writeRuntimeDocument } from "./persistence/runtime.ts";

// The settings document's keys for the Dream defaults administrators once saved for every account.
const retired = {
  enabled: "STUDIO_DREAM_ENABLED",
  paused: "STUDIO_DREAM_PAUSED",
  dailyImages: "STUDIO_DREAM_DAILY_IMAGES",
  dailyVideos: "STUDIO_DREAM_DAILY_VIDEOS",
  images: "STUDIO_DREAM_IMAGES",
  videos: "STUDIO_DREAM_VIDEOS",
  spicy: "STUDIO_DREAM_SPICY",
  imageBackend: "STUDIO_DREAM_IMAGE_BACKEND",
  videoBackend: "STUDIO_DREAM_VIDEO_BACKEND",
};

/**
 * The migrate-runtime step that ends the Dream defaults administrators saved in Settings: each
 * account without its own choice for one saves the default as its choice, so no account's Dream
 * changes, and the defaults leave the settings document. Settings › Dream forces nothing until an
 * administrator sets an override. Plans by default; `apply` writes. A second run finds nothing.
 */
export function dreamDefaultChoices(dataDir, { apply = false } = {}) {
  const settings = savedDocument(dataDir, "settings") ?? {};
  const keys = Object.values(retired).filter((key) => key in settings);
  if (!keys.length) return { applied: apply, settings: 0, accounts: 0 };
  const defaults = Object.fromEntries(
    Object.entries(retired)
      .filter(([, key]) => settings[key])
      .map(([name, key]) => {
        const value = settings[key];
        const fallback = dreamDefaults[name];
        return [
          name,
          typeof fallback === "boolean"
            ? value !== "0"
            : typeof fallback === "number"
              ? Number(value)
              : value,
        ];
      }),
  );
  const dreams = new Map(ownerDocuments(dataDir, "dream").map(({ name, value }) => [name, value]));
  const accounts = savedDocument(dataDir, "accounts")?.accounts ?? [];
  // Single-user mode's one owner is "".
  const owners = accounts.length ? accounts.map((account) => `dream:${account.id}`) : ["dream:"];
  const changed = [...new Set([...dreams.keys(), ...owners])].flatMap((name) => {
    const record = dreams.get(name) ?? {};
    const missing = Object.entries(defaults).filter(
      ([key]) => record.settings?.[key] === undefined,
    );
    return missing.length
      ? [
          {
            name,
            value: { ...record, settings: { ...Object.fromEntries(missing), ...record.settings } },
          },
        ]
      : [];
  });
  if (apply) {
    for (const { name, value } of changed) writeRuntimeDocument(dataDir, name, value);
    writeRuntimeDocument(
      dataDir,
      "settings",
      Object.fromEntries(Object.entries(settings).filter(([key]) => !keys.includes(key))),
    );
  }
  return { applied: apply, settings: keys.length, accounts: changed.length };
}
