// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether a Civitai version may be downloaded (design §4, Paid Files). Paid, early-access and
 * restricted files are never downloaded; anything that can't be read for certain counts as
 * unavailable. Pure: no network.
 */
const knownAvailability = new Set(['Public', 'Unsearchable']);

/**
 * Whether Civitai lets this version (and file) be downloaded freely:
 * `{available: true}` or `{available: false, reason: paid|early-access|licence|no-checksum, note}`.
 * `now` is for tests. Unknown or unreadable values count as unavailable.
 */
export function civitaiAvailability(version, file = null, { now = Date.now(), model = version?.model } = {}) {
  const deny = (reason, note) => ({ available: false, reason, note });
  if (!version || typeof version !== 'object') return deny('licence', 'Civitai didn’t say whether this version can be downloaded.');
  const config = version.earlyAccessConfig && typeof version.earlyAccessConfig === 'object' ? version.earlyAccessConfig : null;
  const price = Number(config?.downloadPrice || 0);
  const ends = version.earlyAccessEndsAt;
  let earlyUntil = 0;
  if (ends !== undefined && ends !== null && ends !== '') {
    earlyUntil = Date.parse(String(ends));
    if (!Number.isFinite(earlyUntil)) return deny('early-access', 'Civitai lists an early-access period that couldn’t be read.');
  }
  const early = version.availability === 'EarlyAccess' || earlyUntil > now;
  if (early || config?.chargeForDownload === true || price > 0) {
    if (config?.chargeForDownload === true || price > 0) return deny('paid', price > 0 ? `Downloads cost ${price} Buzz on Civitai.` : 'Downloads are paid on Civitai.');
    return deny('early-access', earlyUntil > now ? `In early access on Civitai until ${new Date(earlyUntil).toISOString().slice(0, 10)}.` : 'In early access on Civitai.');
  }
  if (version.availability !== undefined && !knownAvailability.has(version.availability)) return deny('licence', `Civitai lists this version as ${typeof version.availability === 'string' ? version.availability : 'restricted'}.`);
  if (version.usageControl !== undefined && version.usageControl !== null && version.usageControl !== 'Download') return deny('licence', 'The creator allows generation on Civitai only, not downloads.');
  if (model && typeof model === 'object' && ['Archived', 'TakenDown'].includes(model.mode)) return deny('licence', model.mode === 'Archived' ? 'The creator archived this model.' : 'Civitai took this model down.');
  if (version.status !== undefined && version.status !== 'Published') return deny('licence', 'This version isn’t published.');
  if (version.requireAuth === true && !process.env.CIVITAI_API_TOKEN) return deny('licence', 'Civitai needs a token for this download. Add one to the deployment.');
  if (file && !/^[a-f0-9]{64}$/i.test(file.hashes?.SHA256 || '')) return deny('no-checksum', 'Civitai publishes no SHA-256 for this file.');
  return { available: true };
}

