import assert from 'node:assert/strict';
import test from 'node:test';
import { statusForProfile } from '../src/app/backendStatus.js';

const status = { connected: true, checked: true, backends: { primary: { connected: false, device: '', url: 'http://images:8188' }, video: { connected: true, device: 'Video GPU', url: 'http://video:8188' } } };
test('connection follows the selected generation without hiding the other connection', () => {
  assert.equal(statusForProfile(status, { kind: 'image' }).connected, false);
  const video = statusForProfile(status, { kind: 'video', family: 'wan21' });
  assert.equal(video.connected, true);
  assert.equal(video.device, 'Video GPU');
  assert.equal(video.url, 'http://video:8188');
  assert.equal(video.backends, status.backends);
  const providerVideo = statusForProfile(status, { kind: 'video', family: 'grok' });
  assert.equal(providerVideo.connected, false);
  assert.equal(providerVideo.label, 'Video');
});
test('single-backend connections and primary restarts keep their existing behaviour', () => {
  const single = { connected: false, restarting: true };
  assert.equal(statusForProfile(single, { kind: 'video' }), single);
  assert.equal(statusForProfile({ ...status, restarting: true }, { kind: 'video' }).restarting, false);
});
