// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Substitutes (design §4, Substitutes): when an import's exact file is missing, the nearest
 * installed file that can stand in for it, always marked and always lowering the grade. Only
 * same-family files qualify, in this order:
 *
 *   precision  the same model in another precision or format (FP8 for BF16, a GGUF quant)
 *   version    another version of the same model (nearest first, newer before older)
 *   family     for a base model only: an installed profile of the same family
 *
 * A LoRA is never replaced by a different LoRA. Pure: no files, no network.
 */
import { fileStem } from './image-metadata.js';

const precisionPattern = /^(fp8(?:_?e4m3fn|_?e5m2)?(?:_?scaled)?|e4m3fn|e5m2|fp16|f16|bf16|fp32|f32|nf4|int8|int4|q\d+(?:_k)?(?:_[msl0-9])?|q\d+_\d|scaled|pruned|prunedonly|emaonly|ema|full|svdq?|mxfp4|nvfp4)$/i;
const versionPattern = /^v?\d+(?:[._]\d+)*[a-z]?$/i;

/** A model file's name split into its line (the model), version and precision tokens. */
export function nameParts(name = '') {
  const stem = fileStem(name);
  // A GGUF quant ("Q4_K_M") and an FP8 kind ("fp8_e4m3fn") are one token each.
  const tokens = stem.replace(/(^|[-_. ])(q\d+(?:_k)?(?:_[msl0-9])?|fp8_e4m3fn|fp8_e5m2)(?=$|[-_. ])/gi, (_match, lead, token) => `${lead}${token.replace(/_/g, '~')}`)
    .split(/[-_. ]+/).filter(Boolean).map((token) => token.replace(/~/g, '_'));
  const precision = tokens.filter((token) => precisionPattern.test(token));
  const rest = tokens.filter((token) => !precisionPattern.test(token));
  const versions = rest.filter((token) => versionPattern.test(token));
  const line = rest.filter((token) => !versionPattern.test(token)).join('-');
  return { stem, model: rest.join('-'), line, version: versions.join('.'), precision: precision.join('-'), gguf: /\.gguf$/i.test(String(name)) };
}

const versionNumber = (version) => {
  const parts = String(version || '').replace(/^v/i, '').split(/[._]/).map(Number).filter(Number.isFinite);
  return parts.reduce((sum, part, index) => sum + part / 1000 ** index, 0);
};
const plain = (version) => String(version || '').replace(/^v/i, '');
const words = (parts) => [parts.precision ? parts.precision.toUpperCase() : '', parts.gguf ? 'GGUF' : ''].filter(Boolean).join(' ') || 'full precision';
const modelRoles = new Set(['checkpoint', 'diffusion_model']);

/**
 * The best stand-in for `want` ({file, name, folder}) among `installed` files ([{folder, file}]),
 * or null. For a base model, `family` (the wanted model's family id, when known) and `profiles`
 * ([{id, label, family, model}]) allow a family equivalent. `role` is the resource's role.
 * Returns {file, folder, kind: precision|version|family, reason, profileId?}.
 */
export function findSubstitute(want = {}, installed = [], { role = '', family = '', familyName = '', profiles = [] } = {}) {
  const name = want.file || want.name || '';
  const wanted = nameParts(name);
  if (!wanted.stem) return null;
  const folders = modelRoles.has(role) || ['checkpoints', 'diffusion_models'].includes(want.folder) ? ['checkpoints', 'diffusion_models'] : [want.folder];
  const candidates = installed.filter((item) => folders.includes(item.folder) && item.file && fileStem(item.file) !== wanted.stem);
  const parts = candidates.map((item) => ({ item, parts: nameParts(item.file) }));
  // Another precision or format of the very same model and version.
  const precision = parts.find(({ parts: other }) => other.model && other.model === wanted.model && (other.precision !== wanted.precision || other.gguf !== wanted.gguf));
  if (precision) return { file: precision.item.file, folder: precision.item.folder, kind: 'precision', reason: `The same model in ${words(precision.parts)} instead of ${words(wanted)}` };
  // Another version of the same model: the nearest, newer first.
  if (wanted.line) {
    const target = versionNumber(wanted.version);
    const versions = parts.filter(({ parts: other }) => other.line === wanted.line && other.version !== wanted.version)
      .sort((a, b) => Math.abs(versionNumber(a.parts.version) - target) - Math.abs(versionNumber(b.parts.version) - target) || versionNumber(b.parts.version) - versionNumber(a.parts.version));
    if (versions.length) {
      const chosen = versions[0];
      return { file: chosen.item.file, folder: chosen.item.folder, kind: 'version', reason: `Version ${plain(chosen.parts.version) || 'without a number'} instead of ${plain(wanted.version) || 'the recorded one'}` };
    }
  }
  // A base model of the same family, run by one of its profiles.
  if (modelRoles.has(role) && family) {
    const profile = profiles.find((item) => item.family === family && item.model);
    if (profile) return { file: profile.model, folder: '', kind: 'family', profileId: profile.id, reason: `Another ${familyName || family} model: ${profile.label || profile.model}` };
  }
  return null;
}
