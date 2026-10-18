import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseChanges, validateReleaseTag } from './release-plan.mjs';
import { defaultReleaseApi, releaseIdentity, releasesUrl, requireForkSigningOwnership, validateReleaseSource, validateStagedReleaseIdentity } from '../server/release-identity.js';
import { pickAsset } from '../server/updater.js';

test('only local task notes are exempt from release cleanliness', () => {
  assert.deepEqual(releaseChanges('?? todo.md\n?? questions.md\n M package.json\n?? other.md'), [' M package.json', '?? other.md']);
  assert.deepEqual(releaseChanges('A  todo.md\n M questions.md'), ['A  todo.md', ' M questions.md']);
});

test('immutable fork release tags must match the numeric package version', () => {
  assert.doesNotThrow(() => validateReleaseTag('0.19.0', 'refs/tags/v0.19.0'));
  for (const ref of ['refs/heads/main', 'refs/tags/v0.18.0', 'v0.19.0']) assert.throws(() => validateReleaseTag('0.19.0', ref), /tag/);
  for (const version of ['01.19.0', '0.19.0-beta', 'latest']) assert.throws(() => validateReleaseTag(version, `refs/tags/v${version}`), /Semantic/);
});

test('default feed and downloads belong to the fork, with upstream recorded separately', () => {
  assert.equal(releaseIdentity.repository, 'maxexcloo/heiss-ui');
  assert.equal(releaseIdentity.upstream.repository, 'tristmeister/HEISS-UI');
  assert.equal(defaultReleaseApi, 'https://api.github.com/repos/maxexcloo/heiss-ui/releases/latest');
  assert.equal(releasesUrl, 'https://github.com/maxexcloo/heiss-ui/releases');
  const release = { tag_name: 'v0.19.0', html_url: `${releasesUrl}/tag/v0.19.0`, assets: [{ name: 'heiss-ui-0.19.0.zip', browser_download_url: `${releasesUrl}/download/v0.19.0/heiss-ui-0.19.0.zip` }] };
  assert.equal(validateReleaseSource(release), release);
  assert.throws(() => validateReleaseSource({ ...release, html_url: release.html_url.replace(releaseIdentity.repository, releaseIdentity.upstream.repository) }), /fork/);
  assert.throws(() => validateReleaseSource({ ...release, assets: [{ ...release.assets[0], browser_download_url: release.assets[0].browser_download_url.replace(releaseIdentity.repository, releaseIdentity.upstream.repository) }] }), /fork/);
});

test('the updater never substitutes a platform, mismatched, draft or prerelease archive', () => {
  const assets = [{ name: 'heiss-ui-0.18.0.zip' }, { name: 'heiss-ui-0.19.0-windows-x64.zip' }];
  assert.equal(pickAsset({ tag_name: 'v0.19.0', assets }), null);
  assets.push({ name: 'heiss-ui-0.19.0.zip' });
  assert.equal(pickAsset({ tag_name: 'v0.19.0', assets }).name, 'heiss-ui-0.19.0.zip');
  assert.equal(pickAsset({ tag_name: 'v0.19.0', assets, draft: true }), null);
  assert.equal(pickAsset({ tag_name: 'v0.19.0', assets, prerelease: true }), null);
});

test('publication fails closed until fork signing ownership is verified', () => {
  assert.throws(() => requireForkSigningOwnership('tristmeister/HEISS-UI'), /repository/);
  assert.throws(() => requireForkSigningOwnership(), /ownership/);
});


test('staged upstream archives are refused even when a release lists them under a fork URL', () => {
  assert.throws(() => validateStagedReleaseIdentity({ version: '0.19.0' }), /fork/);
  assert.throws(() => validateStagedReleaseIdentity({ repository: releaseIdentity.upstream.repository }), /fork/);
  assert.doesNotThrow(() => validateStagedReleaseIdentity({ repository: releaseIdentity.repository }));
});
