import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  test(
    `${signal} drains an active stream, saves the final gallery and exits explicitly`,
    { timeout: 10000 },
    async (t) => {
      const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-shutdown-"));
      // Linux PID 1 ignores signals with their default terminating disposition. Emulate
      // that boundary without requiring a privileged container in the source checks.
      const source = `
      import { installShutdown } from './backend/shutdown.js';
      import { startSession } from './backend/exit-record.js';
      import { setGallery, flushPendingGallery } from './backend/gallery-store.js';
      import http from 'node:http';
      const kill = process.kill.bind(process);
      process.kill = (pid, signal) => pid === process.pid ? true : kill(pid, signal);
      startSession();
      setGallery([{ id: 'shutdown-pending', jobId: 'shutdown-pending', type: 'image', status: 'pending', prompt: 'Saved before stop' }]);
      const server = http.createServer((_req, res) => { res.writeHead(200); res.write('stream open'); });
      installShutdown({
        flush: flushPendingGallery,
        drain: async () => {
          process.send({ type: 'draining' });
          await new Promise(resolve => server.close(resolve));
          setGallery([{ id: 'shutdown-pending', type: 'image', status: 'done', prompt: 'Saved after draining' }]);
        }
      });
      server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
      setInterval(() => {}, 1000);
    `;
      const child = fork(new URL("../backend/index.js", import.meta.url), [], {
        cwd: new URL("..", import.meta.url),
        execArgv: ["--input-type=module", "--eval", source],
        env: { ...process.env, STUDIO_DATA_DIR: data, STUDIO_ENV_FILE: path.join(data, ".env") },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      const exited = new Promise((resolve) =>
        child.once("exit", (code, receivedSignal) => resolve({ code, signal: receivedSignal })),
      );
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
        fs.rmSync(data, { recursive: true, force: true });
      });
      const { port } = await new Promise((resolve, reject) => {
        child.once("message", resolve);
        child.once("exit", () =>
          reject(new Error("The shutdown fixture exited before listening.")),
        );
      });
      const response = await fetch(`http://127.0.0.1:${port}`);
      const draining = new Promise((resolve) => child.once("message", resolve));
      child.kill(signal);
      assert.deepEqual(await draining, { type: "draining" });
      await response.body.cancel();
      assert.deepEqual(await exited, { code: 0, signal: null });
      const gallery = JSON.parse(fs.readFileSync(path.join(data, "gallery.json"), "utf8"));
      assert.equal(gallery[0].id, "shutdown-pending");
      assert.equal(gallery[0].status, "done");
      assert.equal(gallery[0].prompt, "Saved after draining");
      const record = JSON.parse(fs.readFileSync(path.join(data, "logs/last-exit.json"), "utf8"));
      assert.equal(record.clean, true);
      assert.equal(record.code, 0);
      assert.equal(record.signal, signal);
    },
  );
}

test("an uncaught exception logs its cause and synchronously saves pending gallery changes", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-crash-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import { installShutdown } from './backend/shutdown.js';
      import { startSession } from './backend/exit-record.js';
      import { setGallery, flushPendingGallery } from './backend/gallery-store.js';
      installShutdown({ flush: flushPendingGallery });
      startSession();
      setGallery([{ id: 'crash-pending', type: 'image', status: 'pending' }]);
      setImmediate(() => { throw new Error('Fixture crash'); });
    `,
      ],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, STUDIO_DATA_DIR: data, STUDIO_ENV_FILE: path.join(data, ".env") },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    const gallery = JSON.parse(fs.readFileSync(path.join(data, "gallery.json"), "utf8"));
    assert.equal(gallery[0].id, "crash-pending");
    const record = JSON.parse(fs.readFileSync(path.join(data, "logs/last-exit.json"), "utf8"));
    assert.deepEqual(
      [record.clean, record.code, record.reason],
      [false, 1, "The server crashed: Fixture crash"],
    );
    const log = fs
      .readdirSync(path.join(data, "logs"))
      .find((name) => /^studio-.*\.log$/.test(name));
    assert.match(
      fs.readFileSync(path.join(data, "logs", log), "utf8"),
      /Crashed: uncaught exception.*Fixture crash/,
    );
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test(
  "a stalled drain ends with a failed stop and keeps pending work durable for recovery",
  { timeout: 10000 },
  async (t) => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-stalled-shutdown-"));
    const source = `
    import { installShutdown } from './backend/shutdown.js';
    import { startSession } from './backend/exit-record.js';
    import { setGallery, flushPendingGallery } from './backend/gallery-store.js';
    startSession();
    setGallery([{ id: 'still-accepted', type: 'image', status: 'pending' }]);
    installShutdown({ flush: flushPendingGallery, drain: () => new Promise(() => {}), graceMs: 25 });
    process.send({ ready: true });
    setInterval(() => {}, 1000);
  `;
    const child = fork(new URL("../backend/index.js", import.meta.url), [], {
      cwd: new URL("..", import.meta.url),
      execArgv: ["--input-type=module", "--eval", source],
      env: { ...process.env, STUDIO_DATA_DIR: data, STUDIO_ENV_FILE: path.join(data, ".env") },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const exited = new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      fs.rmSync(data, { recursive: true, force: true });
    });
    await new Promise((resolve) => child.once("message", resolve));
    child.kill("SIGTERM");
    assert.deepEqual(await exited, { code: 1, signal: null });
    const gallery = JSON.parse(fs.readFileSync(path.join(data, "gallery.json"), "utf8"));
    assert.deepEqual([gallery[0].id, gallery[0].status], ["still-accepted", "pending"]);
    const record = JSON.parse(fs.readFileSync(path.join(data, "logs/last-exit.json"), "utf8"));
    assert.equal(record.clean, false);
    assert.match(record.reason, /Shutdown timed out/);
  },
);
