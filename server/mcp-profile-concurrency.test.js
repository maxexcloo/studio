import assert from 'node:assert/strict';
import test from 'node:test';
import { McpMedia } from './mcp-media.js';

test('concurrent profile discovery shares one scan and refreshes after settlement', async () => {
  const media = Object.create(McpMedia.prototype);
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

test('a failed shared scan does not poison later discovery', async () => {
  const media = Object.create(McpMedia.prototype);
  media.request = async () => { throw new Error('temporarily offline'); };
  await assert.rejects(media.profiles(), /temporarily offline/);
  media.request = async () => ({ profiles: [] });
  assert.deepEqual(await media.profiles(), []);
});
