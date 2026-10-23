// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block in a workflow or profile file that maps Studio's controls onto the graph.
 *
 * Studio reads the new `studio` name and the established `heissUi` name (plus the older
 * `heiss_ui`, `jAiStudio` and `j_ai_studio`). It keeps writing `heissUi` until the seed in
 * `ai/profiles/` is migrated, so every file it writes stays readable by the seed's own checks.
 * A file carrying both `studio` and `heissUi` is ambiguous and refused by validateProfileText.
 */
export const profileBlockNames = Object.freeze([
  "studio",
  "heissUi",
  "heiss_ui",
  "jAiStudio",
  "j_ai_studio",
]);
/** The name Studio writes. Change it only after the seed is migrated to `studio`. */
export const writtenBlockName = "heissUi";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Which block name a file uses, or '' without one. `studio` wins when both are present. */
export function profileBlockName(raw) {
  if (!isObject(raw)) return "";
  return profileBlockNames.find((name) => isObject(raw[name])) || "";
}

/** The file's block, or null. */
export function profileBlock(raw) {
  const name = profileBlockName(raw);
  return name ? raw[name] : null;
}

/** Block names present in a file, in reading order (more than one is ambiguous). */
export function profileBlocksIn(raw) {
  return isObject(raw) ? profileBlockNames.filter((name) => isObject(raw[name])) : [];
}

/**
 * The file with `block` (by default its own) under the written name (`heissUi`), the other names
 * removed and the remaining keys in their order. Used whenever Studio writes a profile.
 */
export function withWrittenBlock(raw, block = profileBlock(raw)) {
  if (!block) return raw;
  const out = { [writtenBlockName]: block };
  for (const [key, value] of Object.entries(raw))
    if (!profileBlockNames.includes(key)) out[key] = value;
  return out;
}
