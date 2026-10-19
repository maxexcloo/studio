import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseChanges, validateReleaseTag } from './release-plan.mjs';
import { releaseIdentity, releasesUrl } from '../server/release-identity.js';

test('only local task notes are exempt from release cleanliness', () => {
  assert.deepEqual(releaseChanges('?? todo.md\n?? questions.md\n M package.json\n?? other.md'), [' M package.json', '?? other.md']);
  assert.deepEqual(releaseChanges('A  todo.md\n M questions.md'), ['A  todo.md', ' M questions.md']);
});

test('immutable fork release tags must match the numeric package version', () => {
  assert.doesNotThrow(() => validateReleaseTag('0.19.0', 'refs/tags/v0.19.0'));
  for (const ref of ['refs/heads/main', 'refs/tags/v0.18.0', 'v0.19.0']) assert.throws(() => validateReleaseTag('0.19.0', ref), /tag/);
  for (const version of ['01.19.0', '0.19.0-beta', 'latest']) assert.throws(() => validateReleaseTag(version, `refs/tags/v${version}`), /Semantic/);
});

test('release links belong to the fork, with upstream recorded separately', () => {
  assert.equal(releaseIdentity.repository, 'maxexcloo/studio');
  assert.equal(releaseIdentity.upstream.repository, 'tristmeister/HEISS-UI');
  assert.equal(releasesUrl, 'https://github.com/maxexcloo/studio/releases');
});
