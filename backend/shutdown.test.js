import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { fixtureObjectInfo, startFakeComfy } from "./fixtures/fake-comfy.js";
import { writeTestWorkflows } from "./fixtures/test-workflows.js";
import { readGalleryRows } from "./persistence/gallery-rows.ts";

/** The gallery a stopped fixture saved. */
function savedGallery(data) {
  const db = new DatabaseSync(path.join(data, "studio.sqlite"), { readOnly: true });
  try {
    return readGalleryRows(db);
  } finally {
    db.close();
  }
}

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
      import { putGalleryItems } from './backend/gallery/store.js';
      import http from 'node:http';
      const kill = process.kill.bind(process);
      process.kill = (pid, signal) => pid === process.pid ? true : kill(pid, signal);
      putGalleryItems([{ id: 'shutdown-pending', jobId: 'shutdown-pending', type: 'image', status: 'pending', prompt: 'Saved before stop' }]);
      const server = http.createServer((_req, res) => { res.writeHead(200); res.write('stream open'); });
      installShutdown({
        drain: async () => {
          process.send({ type: 'draining' });
          await new Promise(resolve => server.close(resolve));
          putGalleryItems([{ id: 'shutdown-pending', type: 'image', status: 'done', prompt: 'Saved after draining' }]);
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
      const gallery = savedGallery(data);
      assert.equal(gallery[0].id, "shutdown-pending");
      assert.equal(gallery[0].status, "done");
      assert.equal(gallery[0].prompt, "Saved after draining");
    },
  );
}

test(
  "Studio ends an assistant stream and disconnects an unfinished upload on SIGTERM",
  { timeout: 15000 },
  async (t) => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-http-shutdown-"));
    t.after(() => fs.rmSync(data, { recursive: true, force: true }));
    writeTestWorkflows(data);
    const objectInfo = fixtureObjectInfo();
    objectInfo.CheckpointLoaderSimple.input.required.ckpt_name[0] = ["sd_xl_base_1.0.safetensors"];
    const worker = await startFakeComfy({ objectInfo });
    t.after(() => worker.close());
    const gateway = http.createServer(async (req, res) => {
      if (req.url.endsWith("/models")) {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ data: [{ id: "cloud/auto" }] }));
      }
      await Array.fromAsync(req);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"A cabin"}}]}\n\n');
    });
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");
    t.after(() => {
      gateway.closeAllConnections();
      gateway.close();
    });
    const child = fork(new URL("./index.js", import.meta.url), [], {
      env: {
        PATH: process.env.PATH,
        HOST: "127.0.0.1",
        PORT: "0",
        STUDIO_DATA_DIR: data,
        STUDIO_ENV_FILE: "/dev/null",
        STUDIO_WORKERS: JSON.stringify([
          { id: "chosen", url: worker.url, capabilities: ["image"] },
        ]),
        STUDIO_ASSISTANT_URL: `http://127.0.0.1:${gateway.address().port}`,
        STUDIO_ASSISTANT_KEY: "fixture-key",
        STUDIO_ASSISTANT_CLOUD_MODEL: "cloud/auto",
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const exited = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    });
    const [{ url }] = await Promise.race([
      once(child, "message"),
      exited.then(() => {
        throw new Error("Shutdown fixture exited before listening.");
      }),
    ]);
    const response = await fetch(`${url}/api/assistant/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: "custom:test-image", prompt: "A cabin", stream: true }),
    });
    assert.match(response.headers.get("Content-Type"), /text\/event-stream/);

    const upload = net.connect(Number(new URL(url).port), "127.0.0.1");
    t.after(() => upload.destroy());
    const disconnected = once(upload, "close");
    await once(upload, "connect");
    // 100 Continue confirms the server is waiting for the declared body.
    upload.write(
      "POST /api/generate HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 50\r\nExpect: 100-continue\r\n\r\n",
    );
    const [acknowledged] = await once(upload, "data");
    assert.match(acknowledged.toString(), /100 Continue/);

    child.kill("SIGTERM");
    assert.match(await response.text(), /event: error\ndata: .*Studio is stopping/);
    await disconnected;
    assert.deepEqual(await exited, [0, null]);
  },
);

test("an uncaught exception logs its cause, with gallery changes already saved", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-crash-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import { installShutdown } from './backend/shutdown.js';
      import { putGalleryItems } from './backend/gallery/store.js';
      installShutdown();
      putGalleryItems([{ id: 'crash-pending', type: 'image', status: 'pending' }]);
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
    const gallery = savedGallery(data);
    assert.equal(gallery[0].id, "crash-pending");
    assert.match(result.stderr, /Crashed: uncaught exception.*Fixture crash/);
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
    import { putGalleryItems } from './backend/gallery/store.js';
    putGalleryItems([{ id: 'still-accepted', type: 'image', status: 'pending' }]);
    installShutdown({ drain: () => new Promise(() => {}), graceMs: 25 });
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
    const gallery = savedGallery(data);
    assert.deepEqual([gallery[0].id, gallery[0].status], ["still-accepted", "pending"]);
  },
);
