import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateRuntime } from "../persistence/migration.ts";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";
import { RewriteStore } from "../domain/store.ts";
import { RuntimeController, type Workload } from "./controller.ts";
import { legacyRecoverySwitchGuard } from "./legacy-recovery.ts";

const workloads: Workload[] = [
  { id: "image", container: "image", devices: ["0"], kind: "media", url: "http://image:8188" },
  { id: "text", container: "text", devices: ["0"], kind: "text", url: "http://text:8000" },
  {
    id: "independent",
    container: "independent",
    devices: ["1"],
    kind: "media",
    url: "http://video:8188",
  },
  {
    id: "other-media",
    container: "other-media",
    devices: ["0"],
    kind: "media",
    url: "http://other:8188",
  },
];

test("migrated accepted legacy generation holds text and media switches until its own outputs are saved", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-legacy-admission-"));
  let store: RewriteStore | undefined;
  try {
    fs.writeFileSync(
      path.join(directory, "gallery.json"),
      JSON.stringify([{ jobId: "owned-old-job", ownerId: "alice", status: "pending", url: "" }]),
    );
    assert.equal(migrateRuntime(directory, { apply: true }).applied, true);
    store = new RewriteStore(path.join(directory, "studio.sqlite"));
    const gallery = readRuntimeDocument(directory, "gallery") as { jobId: string }[];
    const ids = gallery
      .map((item) => item.jobId)
      .filter((id) => !store!.jobs().some((job) => job.id === id));
    let phase: "offline" | "running" | "done" = "offline",
      saveFails = true;
    const operations: string[] = [];
    const running = new Set(["image", "independent"]);
    const controller = new RuntimeController(
      {
        running: async (id) => running.has(id),
        stop: async (id) => {
          operations.push(`stop:${id}`);
          running.delete(id);
        },
        start: async (id) => {
          operations.push(`start:${id}`);
          running.add(id);
        },
      },
      workloads,
      true,
    );
    controller.beforeStop = legacyRecoverySwitchGuard({
      ids,
      recover: async () => {},
      inspect: () => ({
        backendUrl: phase === "offline" ? undefined : workloads[0].url,
        settled: phase === "done",
      }),
      save: async (protectedIds) => {
        assert.deepEqual(protectedIds, ["owned-old-job"]);
        if (saveFails) throw new Error("Output storage is full");
        writeRuntimeDocument(directory, "gallery", [
          {
            jobId: "owned-old-job",
            ownerId: "alice",
            status: "done",
            url: "/comfy/view?filename=result.png&type=media",
          },
        ]);
        operations.push("saved");
      },
    });
    await assert.rejects(controller.acquire("text"), /legacy generations/);
    assert.deepEqual(operations, []);
    phase = "running";
    (await controller.acquire("image")).release();
    (await controller.acquire("independent")).release();
    await assert.rejects(controller.acquire("other-media"), /legacy generations/);
    assert.deepEqual(operations, []);
    phase = "done";
    await assert.rejects(controller.acquire("text"), /storage is full/);
    assert.deepEqual(operations, []);
    saveFails = false;
    (await controller.acquire("text")).release();
    assert.deepEqual(operations, ["saved", "stop:image", "start:text"]);
    assert.match(
      (readRuntimeDocument(directory, "gallery") as { url: string }[])[0].url,
      /type=media/,
    );
    assert.equal(store.jobs().length, 0, "legacy recovery never resubmits or invents a queue job");
  } finally {
    store?.close();
    closeRuntimeDatabase(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a known legacy operation on an independent placement does not block a switch", async () => {
  const stopped: string[] = [];
  // A started worker is confirmed by Engine inspection on the second call.
  let textStarted = false;
  const engine = {
    running: async (id: string) => id === "image" || (id === "text" && textStarted),
    stop: async (id: string) => {
      stopped.push(id);
    },
    start: async () => {
      textStarted = true;
    },
  };
  const independent = new RuntimeController(engine, workloads, true);
  independent.beforeStop = legacyRecoverySwitchGuard({
    ids: ["video-job"],
    recover: async () => {},
    inspect: () => ({ backendUrl: workloads[2].url, settled: false }),
    save: async () => {
      throw new Error("Independent output must not be saved by this switch");
    },
  });
  (await independent.acquire("text")).release();
  assert.deepEqual(stopped, ["image"]);
});
