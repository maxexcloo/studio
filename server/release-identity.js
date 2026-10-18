import fs from 'node:fs';

export const releaseIdentity = JSON.parse(fs.readFileSync(new URL('./release-identity.json', import.meta.url), 'utf8'));
export const repositoryUrl = `https://github.com/${releaseIdentity.repository}`;
export const releasesUrl = `${repositoryUrl}/releases`;
export const defaultReleaseApi = `https://api.github.com/repos/${releaseIdentity.repository}/releases/latest`;

/** Publishing requires an explicitly verified fork key, beyond matching key bytes. */
export function requireForkSigningOwnership(repository = releaseIdentity.repository) {
  if (repository !== releaseIdentity.repository) throw new Error('The release repository does not match the configured fork.');
  if (releaseIdentity.signingOwner !== repository) throw new Error('Fork release-key ownership and the installed-key transition have not been verified.');
}

/** The default feed may offer only artifacts published by this fork. Test feeds are explicit. */
export function validateReleaseSource(release) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(release?.tag_name || '')) throw new Error('The release tag is not a numeric Semantic Version.');
  const tag = encodeURIComponent(release.tag_name);
  if (release.html_url !== `${releasesUrl}/tag/${tag}`) throw new Error('The release page does not belong to this fork.');
  for (const asset of release.assets || []) {
    if (typeof asset.name !== 'string' || asset.browser_download_url !== `${releasesUrl}/download/${tag}/${encodeURIComponent(asset.name)}`) throw new Error('A release asset does not belong to this fork.');
  }
  return release;
}

export function validateStagedReleaseIdentity(metadata) {
  if (metadata?.repository !== releaseIdentity.repository) throw new Error('The staged archive does not belong to this fork.');
}
