import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-backend-queue-'));
process.env.HEISS_DATA_DIR = temporary;
const { jobs, queueClearsAt, trackUpscale } = await import('./jobs.js');
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test('parallel backend queues estimate independently while jobs on one backend remain serial', () => {
  const clocks = [];
  try {
    for (const [id, backend, ms] of [['image-a', 'primary', 10000], ['video-a', 'video', 60000], ['image-b', 'primary', 20000]]) {
      jobs.set(id, { status: 'queued', comfyBackend: backend });
      clocks.push(trackUpscale(id, { trusted: true, totalMs: ms }));
    }
    assert.equal(queueClearsAt(1000, 'primary'), 31000);
    assert.equal(queueClearsAt(1000, 'video'), 61000);
    jobs.set('unknown-image', { status: 'queued' });
    assert.equal(queueClearsAt(1000, 'primary'), null);
    assert.equal(queueClearsAt(1000, 'video'), 61000);
    jobs.get('unknown-image').status = 'done';
    assert.equal(queueClearsAt(1000, 'primary'), 31000);
  } finally {
    jobs.clear();
    clocks.forEach((clock) => clock.end());
  }
});
