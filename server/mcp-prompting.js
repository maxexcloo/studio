// SPDX-License-Identifier: AGPL-3.0-only
// Native port of the HEISS MCP prompting service; see mcp.LICENSE.
import fs from 'node:fs';

export function loadMcpPrompting(file) {
  const configuration = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : { families: {}, packs: {}, profiles: {}, variants: {}, reviewed_on: '' };
  const { families = {}, packs = {}, profiles = {}, variants = {} } = configuration;
  for (const binding of Object.values(profiles)) {
    if (!packs[binding.pack] || binding.variant && !variants[binding.variant] || binding.mode && !packs[binding.pack].modes?.[binding.mode]) throw new Error('Invalid MCP prompting profile binding.');
  }
  for (const kinds of Object.values(families)) for (const pack of Object.values(kinds)) if (!packs[pack]) throw new Error('Invalid MCP prompting family binding.');
  return (profile, detailed = false) => {
    // Profile-owned guidance works without a deployment pack file. Mode-specific
    // overrides are selected by the profile API before the MCP catalogue reads it.
    const owned = profile.prompting;
    if (owned && typeof owned === 'object' && !Array.isArray(owned)) {
      if (detailed) return structuredClone(owned);
      const result = Object.fromEntries(['id', 'summary'].filter(key => owned[key] !== undefined).map(key => [key, owned[key]]));
      for (const key of ['mode', 'variant']) if (owned[key]) result[key] = typeof owned[key] === 'object' ? owned[key].id : owned[key];
      return result;
    }
    const binding = profiles[profile.id] || {};
    const name = binding.pack ?? families[profile.family]?.[profile.kind];
    if (!name) return null;
    const pack = packs[name];
    const { default_mode, modes, ...details } = pack;
    const result = detailed ? { id: name, ...details, reviewed_on: configuration.reviewed_on } : { id: name, summary: pack.summary };
    if (modes) {
      const mode = binding.mode || (modes[profile.kind] ? profile.kind : default_mode);
      if (!modes[mode]) throw new Error('Choose a prompting mode for this profile.');
      result.mode = detailed ? { id: mode, ...modes[mode] } : mode;
    }
    if (binding.variant) result.variant = detailed ? { id: binding.variant, ...variants[binding.variant] } : binding.variant;
    return result;
  };
}
