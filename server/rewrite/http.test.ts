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

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

test(
  "HTTP generation admission saves a related image/refine/animate session and reopens after restart",
  { timeout: 30_000 },
  async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "studio-http-"));
    const reservation = net.createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    let child: ChildProcess | undefined;
    const root = `http://127.0.0.1:${port}`;
    async function start() {
      child = spawn(process.execPath, ["server/index.js"], {
        cwd: projectRoot,
        env: {
          ...process.env,
          NODE_TEST_CONTEXT: "studio-http",
          PORT: String(port),
          STUDIO_ENV_FILE: "/dev/null",
          STUDIO_DATA_DIR: dataDir,
          STUDIO_DEMO: "1",
          STUDIO_WORKERS: "[]",
          STUDIO_MULTI_USER: "",
          STUDIO_CONFIG_DIR: "",
          STUDIO_TEXT_ADMISSION_TOKEN: "",
          STUDIO_RUNTIME_AUTOMATIC: "",
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
    async function completed(sessionId: string, jobId: string): Promise<QueueJob> {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const { jobs } = await api(`/api/sessions/${sessionId}`);
        const job = (jobs as QueueJob[]).find((entry) => entry.id === jobId)!;
        if (["completed", "failed", "cancelled"].includes(job.status)) {
          assert.equal(job.status, "completed", job.reason);
          return job;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Fixture generation did not settle.");
    }
    try {
      await start();
      const { session } = await api("/api/sessions", "POST", { title: "Image → Refine → Animate" });
      let parentJobId: string | undefined;
      const ids: string[] = [];
      for (const operation of ["image", "refine", "animate"]) {
        const ack = await api(`/api/sessions/${session.id}/generations`, "POST", {
          prompt: `Fixture ${operation}`,
          operation,
          kind: operation === "animate" ? "video" : "image",
          steps: 2,
          width: 256,
          height: 256,
          ...(parentJobId ? { parentJobId } : {}),
        });
        const job = await completed(session.id, ack.jobId);
        assert.equal(job.outputs.length, 1);
        assert.equal(job.parentJobId, parentJobId);
        parentJobId = job.id;
        ids.push(job.id);
      }
      const legacy = await api("/api/generate", "POST", {
        clientJobId: "legacy-http-fixture",
        prompt: "Legacy fixture",
        kind: "image",
        steps: 2,
        width: 256,
        height: 256,
      });
      assert.equal(legacy.jobId, "legacy-http-fixture");
      assert.equal(legacy.items.length, 1);
      await completed(legacy.sessionId, legacy.jobId);
      await stop();
      await start();
      const reopened = await api(`/api/sessions/${session.id}`);
      assert.deepEqual(
        (reopened.jobs as QueueJob[]).map((job) => job.id),
        ids,
      );
      assert.equal(
        reopened.jobs.every((job: QueueJob) => job.status === "completed"),
        true,
      );
      const gallery = await api("/api/gallery");
      assert.equal(
        gallery.items.filter((item: { jobId: string }) => ids.includes(item.jobId)).length,
        3,
      );
    } finally {
      await stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
