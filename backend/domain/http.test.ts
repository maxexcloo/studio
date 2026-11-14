import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { QueueJob } from "../../shared/queue.ts";
const { startDemoWorker } = await import(
  new URL("../fixtures/demo-worker.js", import.meta.url).href
);

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

test(
  "HTTP generation admission saves a related image/refine/animate session and reopens after restart",
  { timeout: 30_000 },
  async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "studio-http-"));
    const worker = await startDemoWorker(dataDir);
    const reservation = net.createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    let child: ChildProcess | undefined;
    const root = `http://127.0.0.1:${port}`;
    async function start() {
      child = spawn(process.execPath, ["backend/index.js"], {
        cwd: projectRoot,
        env: {
          ...process.env,
          NODE_TEST_CONTEXT: "studio-http",
          PORT: String(port),
          STUDIO_ENV_FILE: "/dev/null",
          STUDIO_DATA_DIR: dataDir,
          STUDIO_FACE_CHECK: "0",
          STUDIO_IMAGE_SEARCH: "0",
          STUDIO_WORKERS: JSON.stringify([
            { id: "demo", url: worker.url, capabilities: ["image", "video"] },
          ]),
          STUDIO_MULTI_USER: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise<void>((resolve, reject) => {
        let output = "";
        child!.stdout!.on("data", (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes(`http://localhost:${port}`)) resolve();
        });
        child!.once("error", reject);
        child!.once("exit", (code) =>
          reject(new Error(`Fixture exited before readiness (${code}).`)),
        );
      });
    }
    async function stop() {
      if (!child || child.exitCode !== null) return;
      const exit = once(child, "exit");
      child.kill("SIGTERM");
      await exit;
    }
    async function api(route: string, method = "GET", body?: unknown): Promise<any> {
      const response = await fetch(root + route, {
        method,
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      assert.equal(
        response.ok,
        true,
        `Fixture request ${method} ${route} returned ${response.status}`,
      );
      return result;
    }
    async function completed(jobId: string): Promise<QueueJob> {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const { job } = (await api(`/api/queue/${jobId}`)) as { job: QueueJob };
        if (["completed", "failed", "cancelled"].includes(job.status)) {
          assert.equal(job.status, "completed", job.reason);
          return job;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Fixture generation did not settle.");
    }
    // The demo worker's test workflows: each profile names its own workflow and model.
    const profile = (id: string) => ({ profileId: id, workflow: id, model: id });
    try {
      await start();
      const { session } = await api("/api/sessions", "POST", { title: "Image → Refine → Animate" });
      let parentJobId: string | undefined;
      let parentItemId: string | undefined;
      const ids: string[] = [];
      for (const operation of ["image", "refine", "animate"]) {
        const ack = await api(`/api/sessions/${session.id}/generations`, "POST", {
          prompt: `Fixture ${operation}`,
          operation,
          ...profile(operation === "animate" ? "custom:test-video" : "custom:test-image"),
          kind: operation === "animate" ? "video" : "image",
          steps: 2,
          width: 256,
          height: 256,
          ...(parentJobId ? { parentJobId, parentItemId } : {}),
        });
        const job = await completed(ack.jobId);
        // The queue lists a finished job's results as its gallery records.
        assert.equal(job.items.length, 1);
        assert.equal(job.parentJobId, parentJobId);
        // The version link names the parent's result; the gallery groups versions by it.
        assert.equal(job.parentItemId, parentItemId);
        assert.equal(job.input.parentItemId, undefined);
        parentJobId = job.id;
        parentItemId = String(job.items[0].id);
        ids.push(job.id);
      }
      const legacy = await api("/api/generate", "POST", {
        clientJobId: "legacy-http-fixture",
        prompt: "Legacy fixture",
        ...profile("custom:test-image"),
        kind: "image",
        steps: 2,
        width: 256,
        height: 256,
      });
      assert.equal(legacy.jobId, "legacy-http-fixture");
      assert.equal(legacy.items.length, 1);
      await completed(legacy.jobId);
      await stop();
      await start();
      const reopened = await Promise.all(
        ids.map(async (id) => ((await api(`/api/queue/${id}`)) as { job: QueueJob }).job),
      );
      assert.deepEqual(
        reopened.map((job) => [job.id, job.sessionId, job.status]),
        ids.map((id) => [id, session.id, "completed"]),
      );
      const gallery = await api("/api/gallery");
      assert.equal(
        gallery.items.filter((item: { jobId: string }) => ids.includes(item.jobId)).length,
        3,
      );
    } finally {
      await stop();
      await worker.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
