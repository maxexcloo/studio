/**
 * Settings Studio renamed when it became a hard fork of HEISS UI: each
 * `HEISS_<NAME>` became `STUDIO_<NAME>`. The old names still work as
 * deprecated aliases, read only when the new name is unset, so a deployment
 * keeps running until its configuration is updated. Studio writes only the
 * new names. No side effects: the dev launcher reads .env through it too.
 */
export const renamedSettings = Object.freeze([
  "ALLOW_LAN", "ALLOWED_HOSTS", "COMFY_LOST_AFTER_MS", "COMFY_ROOT", "COMFY_SEARCH", "DATA_DIR",
  "DEFAULT_COMFY_URL", "DEMO", "DEV_PROXY_TOKEN", "DEVICE_SESSION_DAYS", "DOCKER_HOST_ONLY",
  "ENABLE_INPAINT", "ENV_FILE", "FFMPEG_PATH", "GALLERY_CHANGELOG_LIMIT", "GALLERY_LIMIT",
  "GALLERY_SAVE_MS", "HTTPS_PORT", "LAN", "PREVIEW_INTERVAL_MS", "REFERENCE_MAX_BYTES",
  "REFERENCE_MAX_PIXELS", "SEEDVR2_HF_REPO", "SEEDVR2_MODEL_DIR", "TERMINAL_JOB_TTL_MS",
  "THUMBNAIL_CACHE_MB", "TLS_CERT", "TLS_KEY", "TRASH_DAYS", "VIDEO_PREVIEW_CACHE_MB"
]);

const renamed = new Set(renamedSettings);

/** HEISS_DATA_DIR → STUDIO_DATA_DIR; anything else unchanged. */
export function currentEnvName(key) {
  const name = String(key || "");
  return name.startsWith("HEISS_") && renamed.has(name.slice(6)) ? `STUDIO_${name.slice(6)}` : name;
}

/** STUDIO_DATA_DIR → HEISS_DATA_DIR; "" for a setting that never had an old name. */
export function legacyEnvName(key) {
  const name = String(key || "");
  return name.startsWith("STUDIO_") && renamed.has(name.slice(7)) ? `HEISS_${name.slice(7)}` : "";
}

/**
 * Fills each unset new name from its old one, in place. `only` limits it to
 * keys from one source (the shell, or .env), so an old name in the shell still
 * beats a new one in .env, as the shell always has. Returns the old names used.
 */
export function applyLegacyEnvNames(env, only = null) {
  const used = [];
  for (const name of renamedSettings) {
    const legacy = `HEISS_${name}`;
    const current = `STUDIO_${name}`;
    if (!(legacy in env) || (only && !only.has(legacy))) continue;
    if (current in env) continue;
    env[current] = env[legacy];
    used.push(legacy);
  }
  return used;
}

/** Old names set beside a different value under the new name, which wins (e.g. an image default). */
export function shadowedLegacyEnvNames(env) {
  return renamedSettings.map((name) => `HEISS_${name}`).filter((legacy) => legacy in env && currentEnvName(legacy) in env && env[legacy] !== env[currentEnvName(legacy)]);
}

/** The one-line notice for old names in use (and old names the new ones override), or "" when there are none. */
export function legacyEnvNotice(used = [], shadowed = []) {
  if (!used.length && !shadowed.length) return "";
  const pairs = [...new Set(used)].sort().map((legacy) => `${legacy} → ${currentEnvName(legacy)}`);
  const ignored = [...new Set(shadowed)].sort().map((legacy) => `${legacy} (ignored: ${currentEnvName(legacy)} is set)`);
  return `Deprecated settings in use; rename them (the old names stop working in a later release): ${[...pairs, ...ignored].join(", ")}.`;
}
