import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

for (const signal of ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? [] : ['SIGHUP'])]) {
  test(`${signal} saves pending gallery changes and exits even when default self-signals are ignored`, { timeout: 10000 }, async t => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shutdown-'));
    // Linux PID 1 ignores signals with their default terminating disposition. Emulate
    // that boundary without requiring a privileged container in the source checks.
    const source = `
      import './server/crash-log-install.js';
      import { startSession } from './server/exit-record.js';
      import { setGallery, saveGallery } from './server/gallery-store.js';
      import http from 'node:http';
      const kill = process.kill.bind(process);
      process.kill = (pid, signal) => pid === process.pid ? true : kill(pid, signal);
      startSession();
      setGallery([{ id: 'shutdown-pending', jobId: 'shutdown-pending', type: 'image', status: 'pending', prompt: 'Saved before stop' }]);
      saveGallery();
      const server = http.createServer((_req, res) => { res.writeHead(200); res.write('stream open'); });
      server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
      setInterval(() => {}, 1000);
    `;
    const child = fork(new URL('../server/index.js', import.meta.url), [], {
      cwd: new URL('..', import.meta.url),
      execArgv: ['--input-type=module', '--eval', source],
      env: { ...process.env, STUDIO_DATA_DIR: data, STUDIO_ENV_FILE: path.join(data, '.env') },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    const exited = new Promise(resolve => child.once('exit', (code, receivedSignal) => resolve({ code, signal: receivedSignal })));
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
      fs.rmSync(data, { recursive: true, force: true });
    });
    const { port } = await new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('exit', () => reject(new Error('The shutdown fixture exited before listening.')));
    });
    const response = await fetch(`http://127.0.0.1:${port}`);
    t.after(() => response.body.cancel().catch(() => {}));
    const started = performance.now();
    child.kill(signal);
    let timer;
    const result = await Promise.race([
      exited,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Studio did not stop within 3 seconds.')), 3000); })
    ]).finally(() => clearTimeout(timer));
    assert.deepEqual(result, { code: 0, signal: null });
    assert.ok(performance.now() - started < 3000);
    const gallery = JSON.parse(fs.readFileSync(path.join(data, 'gallery.json'), 'utf8'));
    assert.equal(gallery[0].id, 'shutdown-pending');
    assert.equal(gallery[0].prompt, 'Saved before stop');
    const record = JSON.parse(fs.readFileSync(path.join(data, 'logs/last-exit.json'), 'utf8'));
    assert.equal(record.clean, true);
    assert.equal(record.code, 0);
  });
}
