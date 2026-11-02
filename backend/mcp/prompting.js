// SPDX-License-Identifier: AGPL-3.0-only
// Native port of the Studio MCP prompting service; see mcp.LICENSE.
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * A profile's prompting: its guide from prompting.json with the profile's own `prompting` fields
 * over it, field by field. A profile keeps only what differs from its guide (ownPrompting), so a
 * guide change reaches every profile that doesn't override that field. Null without either.
 */
export function mergedPrompting(guide, own) {
  if (!isObject(own) || !Object.keys(own).length) return guide ? structuredClone(guide) : null;
  return structuredClone({ ...guide, ...own });
}

/** The fields of a profile's own `prompting` that differ from `guide`: what the profile keeps. */
export function ownPrompting(guide, own) {
  if (!isObject(own)) return {};
  return Object.fromEntries(
    Object.entries(own).filter(([key, value]) => !isDeepStrictEqual(guide?.[key], value)),
  );
}

/**
 * Reads prompting.json (`file`, or nothing) and returns the resolver for a profile
 * (`{id, family, kind, prompting}`): the pack its binding or family names, with its mode, variant
 * and `negatives` entry, merged with the profile's own fields (mergedPrompting).
 */
export function loadMcpPrompting(file) {
  const configuration = file
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { families: {}, packs: {}, profiles: {}, variants: {}, reviewed_on: "" };
  const { families = {}, packs = {}, profiles = {}, variants = {}, negatives = {} } = configuration;
  for (const binding of Object.values(profiles)) {
    if (
      !packs[binding.pack] ||
      (binding.variant && !variants[binding.variant]) ||
      (binding.mode && !packs[binding.pack].modes?.[binding.mode])
    )
      throw new Error("Invalid MCP prompting profile binding.");
  }
  for (const kinds of Object.values(families))
    for (const pack of Object.values(kinds))
      if (!packs[pack]) throw new Error("Invalid MCP prompting family binding.");
  const guideOf = (profile) => {
    const binding = profiles[profile.id] || {};
    const name = binding.pack ?? families[profile.family]?.[profile.kind];
    if (!name) return null;
    const pack = packs[name];
    const { default_mode, modes, ...details } = pack;
    const reviewed = pack.reviewed_on || configuration.reviewed_on;
    const result = { id: name, ...details, ...(reviewed ? { reviewed_on: reviewed } : {}) };
    if (modes) {
      const mode = binding.mode || (modes[profile.kind] ? profile.kind : default_mode);
      if (!modes[mode]) throw new Error("Choose a prompting mode for this profile.");
      result.mode = { id: mode, ...modes[mode] };
    }
    if (binding.variant) result.variant = { id: binding.variant, ...variants[binding.variant] };
    if (!result.negative && isObject(negatives[profile.id]))
      result.negative = negatives[profile.id];
    return result;
  };
  return (profile) => mergedPrompting(guideOf(profile), profile.prompting);
}
