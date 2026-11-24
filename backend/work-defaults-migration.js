import { workSettings } from "../shared/work-defaults.ts";
import { accountRoles } from "./account-policy.js";
import {
  defaultTextProfileKey,
  defaultTextSide,
  mediaDefaultProfileKeys,
} from "./generation-defaults.js";
import { ownerDocuments, savedDocument, writeRuntimeDocument } from "./persistence/runtime.ts";

/** The retired account size preferences, which go without a Studio-wide replacement. */
const sizes = ["imageAspect", "imageCount", "imageResolution", "videoAspect", "videoResolution"];
/** Each kind's retired side preference and per-side models, and the setting its model moves to. */
const kinds = [
  ["images", "imageCloud", "imageLocal", mediaDefaultProfileKeys.image],
  ["videos", "videoCloud", "videoLocal", mediaDefaultProfileKeys.video],
  ["text", "textCloud", "textLocal", defaultTextProfileKey],
];
const retiredPreferences = new Set([
  ...sizes,
  ...kinds.flatMap(([kind, cloud, local]) => [kind, cloud, local]),
]);
/** The Dream settings Where Work Runs decides for everyone, and where each one moves. */
const dreamMoves = [
  ["imageBackend", workSettings.dreamImageBackend.key, "STUDIO_DREAM_OVERRIDE_IMAGE_BACKEND"],
  ["videoBackend", workSettings.dreamVideoBackend.key, "STUDIO_DREAM_OVERRIDE_VIDEO_BACKEND"],
  ["videoSeconds", workSettings.videoSeconds.key],
];

/**
 * The migrate-runtime step that makes Where Work Runs Studio's rather than each account's. The
 * administrator's choices become the saved settings (deployment-settings.js) where none is saved:
 * the model for each kind's chosen side as its default model, and their Dream image and video side
 * and video length (an administrator override of the sides wins). Then every account's copies go:
 * the side, per-side model and size preferences (drafts start from each model's own size again),
 * and Dream's backends and length. Administrators who chose differently are a conflict, and a conflict applies nothing.
 * Safe while Studio runs; settings and preferences reload after it. Plans by default; `apply`
 * writes. A second run finds nothing.
 */
export function whereWorkRunsServerWide(dataDir, { apply = false } = {}) {
  const settings = { ...savedDocument(dataDir, "settings") };
  const admins = new Set(
    (savedDocument(dataDir, "accounts")?.accounts ?? [])
      .filter((account) => account.role === accountRoles.administrator)
      .map((account) => account.id),
  );
  // Single-user mode keeps one owner, "", whose choices are the administrator's.
  const isAdmin = (owner) => owner === "" || admins.has(owner);
  const moved = {};
  const conflicts = [];
  const take = (key, value, owner) => {
    if (value === undefined || value === null || value === "" || overridden.has(key)) return;
    if (Object.hasOwn(settings, key)) return;
    const text = String(value);
    if (Object.hasOwn(moved, key) && moved[key] !== text)
      conflicts.push(`${key}: administrators chose ${moved[key]} and ${text} (${owner}).`);
    else moved[key] = text;
  };
  // An administrator's Dream override applied to everyone, so it wins over anyone's own choice.
  const overridden = new Set();
  for (const [, key, override] of dreamMoves)
    if (override && settings[override] && !Object.hasOwn(settings, key)) {
      moved[key] = settings[override];
      overridden.add(key);
    }
  const preferences = ownerDocuments(dataDir, "preferences");
  for (const { name, value } of preferences) {
    const owner = name.slice("preferences:".length);
    if (!value || !isAdmin(owner)) continue;
    for (const [kind, cloud, local, key] of kinds) {
      const side =
        value[kind] ??
        (kind === "text" ? defaultTextSide({ ...settings, ...process.env }) : "local");
      take(key, value[side === "cloud" ? cloud : local], owner);
    }
  }
  const dreams = ownerDocuments(dataDir, "dream");
  for (const { name, value } of dreams) {
    const owner = name.slice("dream:".length);
    if (!isAdmin(owner)) continue;
    for (const [setting, key] of dreamMoves)
      take(key, value?.settings?.[setting] || undefined, owner);
  }
  const accounts = preferences.flatMap(({ name, value }) => {
    if (!value || !Object.keys(value).some((key) => retiredPreferences.has(key))) return [];
    return [
      {
        name,
        value: Object.fromEntries(
          Object.entries(value).filter(([key]) => !retiredPreferences.has(key)),
        ),
      },
    ];
  });
  const dreamRecords = dreams.flatMap(({ name, value }) => {
    const kept = Object.entries(value?.settings ?? {}).filter(
      ([key]) => !dreamMoves.some(([setting]) => setting === key),
    );
    if (kept.length === Object.keys(value?.settings ?? {}).length) return [];
    return [{ name, value: { ...value, settings: Object.fromEntries(kept) } }];
  });
  const overrides = dreamMoves.flatMap(([, , override]) =>
    override && Object.hasOwn(settings, override) ? [override] : [],
  );
  const applied = apply && !conflicts.length;
  if (applied) {
    for (const key of overrides) delete settings[key];
    if (overrides.length || Object.keys(moved).length)
      writeRuntimeDocument(dataDir, "settings", { ...settings, ...moved });
    for (const { name, value } of [...accounts, ...dreamRecords])
      writeRuntimeDocument(dataDir, name, value);
  }
  return {
    applied,
    settings: moved,
    accounts: accounts.map(({ name }) => name.slice("preferences:".length)),
    dreams: dreamRecords.map(({ name }) => name.slice("dream:".length)),
    retiredOverrides: overrides,
    conflicts,
  };
}
