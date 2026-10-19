import assert from 'node:assert/strict';
import test from 'node:test';
import { McpMedia } from './mcp-media.js';

test('concurrent profile discovery shares one scan and refreshes after the cache expires', async () => {
  const media = Object.create(McpMedia.prototype);
  media.profileTtl = 0;
  let reads = 0;
  let release;
  media.request = async () => {
    reads++;
    await new Promise(resolve => { release = resolve; });
    return { profiles: [{ id: 'image', kind: 'image' }, { id: 'video', kind: 'video' }] };
  };
  const images = media.profiles('image');
  const videos = media.profiles('video');
  assert.equal(reads, 1);
  release();
  assert.deepEqual((await images).map(x => x.id), ['image']);
  assert.deepEqual((await videos).map(x => x.id), ['video']);
  const refreshed = media.profiles();
  assert.equal(reads, 2);
  release();
  assert.equal((await refreshed).length, 2);
});

test('cached discovery is per owner, expires after its TTL and is invalidated by model changes', async () => {
  const media = Object.create(McpMedia.prototype);
  const reads = [];
  media.request = async (_method, _route, _body, owner) => {
    reads.push(owner);
    return { profiles: [{ id: `${owner}-image`, kind: 'image' }, { id: `${owner}-video`, kind: 'video' }] };
  };
  assert.deepEqual((await media.profiles('image', 'alice')).map(x => x.id), ['alice-image']);
  assert.deepEqual((await media.profiles('video', 'alice')).map(x => x.id), ['alice-video']);
  assert.deepEqual(reads, ['alice']);
  assert.deepEqual((await media.profiles('all', 'bob')).map(x => x.id), ['bob-image', 'bob-video']);
  assert.deepEqual(reads, ['alice', 'bob']);
  media.invalidateProfiles();
  await media.profiles('all', 'alice');
  assert.deepEqual(reads, ['alice', 'bob', 'alice']);
  media.profileCache.get('alice').at -= 60000;
  await media.profiles('all', 'alice');
  assert.deepEqual(reads, ['alice', 'bob', 'alice', 'alice']);
});

test('a scan overlapping a model change is not cached', async () => {
  const media = Object.create(McpMedia.prototype);
  let reads = 0;
  media.request = async () => { reads++; media.invalidateProfiles(); return { profiles: [] }; };
  await media.profiles();
  media.request = async () => { reads++; return { profiles: [] }; };
  await media.profiles();
  assert.equal(reads, 2);
});

test('a failed shared scan does not poison later discovery', async () => {
  const media = Object.create(McpMedia.prototype);
  media.request = async () => { throw new Error('temporarily offline'); };
  await assert.rejects(media.profiles(), /temporarily offline/);
  media.request = async () => ({ profiles: [] });
  assert.deepEqual(await media.profiles(), []);
});
