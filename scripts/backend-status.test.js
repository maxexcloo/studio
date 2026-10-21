import assert from 'node:assert/strict';
import test from 'node:test';
import { statusForProfile } from '../src/app/backendStatus.js';

const workers = [
  { id: 'primary', name: 'Image Worker', capabilities: ['image', 'upscale', 'models'], connected: false, device: '', url: 'http://images:8188', default: true },
  { id: 'video', name: 'Video Worker', capabilities: ['video'], connected: true, device: 'Video GPU', url: 'http://video:8188' },
];
const status = { connected: true, checked: true, workers };

test('connection follows the worker the selected profile routes to', () => {
  assert.equal(statusForProfile(status, { kind: 'image' }).connected, false);
  const video = statusForProfile(status, { kind: 'video', family: 'wan21' });
  assert.equal(video.connected, true);
  assert.equal(video.device, 'Video GPU');
  assert.equal(video.url, 'http://video:8188');
  assert.equal(video.label, 'Video Worker');
  assert.equal(video.workers, workers);
  // Provider video runs through an image worker's ComfyUI node.
  const providerVideo = statusForProfile(status, { kind: 'video', family: 'grok' });
  assert.equal(providerVideo.connected, false);
  assert.equal(providerVideo.label, 'Image Worker');
});

test('one worker keeps upstream status; no capable worker says so; restarts follow the default worker', () => {
  const single = { connected: false, restarting: true, workers: [workers[0]] };
  assert.equal(statusForProfile(single, { kind: 'image' }), single);
  const noVideo = statusForProfile({ ...status, workers: [workers[0]] }, { kind: 'video' });
  assert.equal(noVideo.connected, false);
  assert.equal(noVideo.error, 'No worker runs videos');
  assert.equal(statusForProfile({ ...status, restarting: true }, { kind: 'video' }).restarting, false);
  assert.equal(statusForProfile({ connected: false, noWorkers: true }, { kind: 'image' }).error, 'No workers set up');
});
