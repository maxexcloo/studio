import assert from 'node:assert/strict';
import test from 'node:test';
import { createJobRecovery } from './job-recovery.js';

function fixture() {
  const state = {
    backend: '', gallery: [], jobs: new Map(), writes: 0,
    snapshots: { primary: { queue: {}, history: {} }, video: { queue: {}, history: {} } },
  };
  state.recover = createJobRecovery({
    backends: () => Object.keys(state.snapshots),
    finishJob: (id, patch) => state.jobs.set(id, { ...state.jobs.get(id), ...patch, terminalAt: 1 }),
    getGallery: () => state.gallery,
    jobs: state.jobs,
    recordsFromHistory: (history) => Object.values(history).flatMap((entry) => entry.outputs || []),
    request: async (path) => {
      const snapshot = state.snapshots[state.backend];
      if (snapshot.error) throw new Error('Offline');
      return path === '/queue' ? snapshot.queue : snapshot.history;
    },
    setGallery: (items) => { state.gallery = items; state.writes++; },
    visible: (items) => items.filter((item) => !item.deleted),
    withBackend: async (backend, run) => { state.backend = backend; await run(); },
  });
  return state;
}
const tile = (id, status = 'error') => ({ id: `${id}-0`, jobId: id, status, url: '', type: 'video' });
const queued = (id, promptId = `${id}-prompt`) => [0, promptId, {}, { heiss_generation: { jobId: id } }];
const result = (id) => ({ prompt: [0, `${id}-prompt`, {}, { heiss_generation: { jobId: id } }], outputs: [{ id: `${id}.mp4`, jobId: id, url: `${id}.mp4`, status: 'done' }], status: { status_str: 'success' } });

test('restart reattaches failed tiles to running and queued video prompts without submission', async () => {
  const s = fixture();
  s.gallery = [tile('running'), tile('waiting')];
  s.snapshots.video.queue = { queue_running: [queued('running')], queue_pending: [queued('waiting')] };
  await s.recover();
  assert.equal(s.jobs.get('running').status, 'running');
  assert.equal(s.jobs.get('waiting').status, 'queued');
  assert.equal(s.jobs.get('waiting').comfyBackend, 'video');
  assert.equal(s.gallery[0].progress.phase, 'Generating');
  assert.equal(s.gallery[1].progress.phase, 'Queued');
  assert.ok(s.gallery.every((item) => item.status === 'pending'));
  const writes = s.writes;
  await s.recover();
  assert.equal(s.writes, writes, 'unchanged polls do not rewrite the gallery');
});

test('restart recovery keeps the account owner attached to its queued job', async () => {
  const s = fixture();
  s.gallery = [{ ...tile('owned'), ownerId: 'account-a' }];
  s.snapshots.video.queue = { queue_pending: [queued('owned')] };
  await s.recover();
  assert.equal(s.jobs.get('owned').ownerId, 'account-a');
});

test('late completion replaces the false failure and does not duplicate a recovered output', async () => {
  const s = fixture();
  s.gallery = [tile('finished'), ...result('finished').outputs];
  s.snapshots.video.history = { 'finished-prompt': result('finished') };
  await s.recover();
  assert.equal(s.gallery.length, 1);
  assert.equal(s.gallery[0].status, 'done');
  assert.equal(s.jobs.get('finished').status, 'done');
});

test('recovered queued jobs transition to running and then deliver their video', async () => {
  const s = fixture();
  s.gallery = [tile('one')];
  s.snapshots.video.queue = { queue_pending: [queued('one')] };
  await s.recover();
  s.snapshots.video.queue = { queue_running: [queued('one')] };
  await s.recover();
  assert.equal(s.jobs.get('one').status, 'running');
  s.snapshots.video.queue = {};
  s.snapshots.video.history = { 'one-prompt': result('one') };
  await s.recover();
  assert.equal(s.gallery[0].url, 'one.mp4');
  assert.equal(s.jobs.get('one').status, 'done');
});

test('offline backends do not mark jobs failed; a missing recovered prompt requires two confirmed misses', async () => {
  const s = fixture();
  s.gallery = [tile('one', 'pending')];
  s.jobs.set('one', { recovered: true, status: 'running', comfyBackend: 'video' });
  s.snapshots.video.error = true;
  await s.recover();
  assert.equal(s.jobs.get('one').status, 'running');
  s.snapshots.video.error = false;
  await s.recover();
  assert.equal(s.jobs.get('one').status, 'running');
  await s.recover();
  assert.equal(s.jobs.get('one').status, 'error');
});

test('an untracked pending tile fails only after two complete backend scans', async () => {
  const s = fixture();
  s.gallery = [tile('lost', 'pending')];
  await s.recover();
  assert.equal(s.gallery[0].status, 'pending');
  assert.equal(s.jobs.size, 0);
  await s.recover();
  assert.equal(s.gallery[0].status, 'error');
  assert.equal(s.jobs.get('lost').status, 'error');
});

test('an offline backend resets untracked absence and can later recover the job', async () => {
  const s = fixture();
  s.gallery = [tile('lost', 'pending')];
  await s.recover();
  s.snapshots.video.error = true;
  await s.recover();
  await s.recover();
  assert.equal(s.gallery[0].status, 'pending');
  s.snapshots.video.error = false;
  await s.recover();
  assert.equal(s.gallery[0].status, 'pending');
  s.snapshots.video.queue = { queue_pending: [queued('lost')] };
  await s.recover();
  assert.equal(s.jobs.get('lost').status, 'queued');
  assert.equal(s.jobs.get('lost').comfyBackend, 'video');
});

test('zero configured backends cannot establish that a pending job is lost', async () => {
  const s = fixture();
  s.gallery = [tile('lost', 'pending')];
  delete s.snapshots.video;
  delete s.snapshots.primary;
  await s.recover();
  await s.recover();
  assert.equal(s.gallery[0].status, 'pending');
});

test('deleted and cancelled tiles stay absent; live delivery stays with its runner', async () => {
  const s = fixture();
  s.gallery = [{ ...tile('removed'), deleted: true }, tile('cancelled', 'canceled'), tile('live', 'pending')];
  s.jobs.set('live', { status: 'running', comfyBackend: 'video' });
  s.snapshots.video.queue = { queue_running: [queued('removed'), queued('cancelled'), queued('deleted')] };
  s.snapshots.video.history = { 'live-prompt': result('live') };
  await s.recover();
  assert.equal(s.jobs.size, 1);
  assert.equal(s.gallery[0].status, 'error');
  assert.equal(s.gallery[1].status, 'canceled');
  assert.equal(s.gallery[2].status, 'pending');
});

test('an available backend recovers even when the other backend is offline', async () => {
  const s = fixture();
  s.gallery = [tile('one')];
  s.snapshots.primary.error = true;
  s.snapshots.video.history = { 'one-prompt': result('one') };
  await s.recover();
  assert.equal(s.gallery[0].status, 'done');
});

test('cancelling a recovered video keeps it cancelled even if its output arrives', async () => {
  const s = fixture();
  s.gallery = [tile('one', 'canceled')];
  s.jobs.set('one', { recovered: true, status: 'canceling', comfyBackend: 'video' });
  s.snapshots.video.history = { 'one-prompt': result('one') };
  await s.recover();
  assert.equal(s.jobs.get('one').status, 'canceled');
  assert.equal(s.gallery[0].status, 'canceled');
});


test('an untracked job reported lost can still accept a late backend result', async () => {
  const s = fixture();
  s.gallery = [tile('late', 'pending')];
  await s.recover();
  await s.recover();
  assert.equal(s.gallery[0].status, 'error');
  s.snapshots.video.history = { 'late-prompt': result('late') };
  await s.recover();
  assert.equal(s.gallery[0].url, 'late.mp4');
  assert.equal(s.jobs.get('late').status, 'done');
});
