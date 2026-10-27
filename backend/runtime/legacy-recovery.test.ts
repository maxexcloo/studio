import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fakeKubernetes } from "../fixtures/fake-kubernetes.ts";
import { migrateRuntime } from "../persistence/migration.ts";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";
import { RewriteStore } from "../domain/store.ts";
import { RuntimeController, type Workload } from "./controller.ts";
import { KubernetesEngine } from "./kubernetes.ts";
import { legacyRecoverySwitchGuard } from "./legacy-recovery.ts";

const workloads: Workload[] = [
  ["image", "image", "http://image:8188"],
  ["independent", "video", "http://video:8188"],
  ["second", "video", "http://second:8188"],
].map(([id, kind, url]) => ({
  id,
  label: id,
  kind: kind as Workload["kind"],
  namespace: "gpu",
  deployment: id,
  pool: "gpu",
  gpus: 1,
  url,
}));
function controller(running: string[]) {
  const kube = fakeKubernetes(
    workloads.map((item) => ({
      namespace: "gpu",
      name: item.id,
      replicas: running.includes(item.id) ? 1 : 0,
    })),
  );
  return {
    kube,
    controller: new RuntimeController({
      engine: new KubernetesEngine(kube.request),
      workloads,
      pools: { gpu: 2 },
      automaticLifecycle: true,
      sleep: async () => kube.tick(),
    }),
  };
}

test("migrated accepted legacy generation holds a switch until its own outputs are saved", async () => {
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
    const saved: string[] = [];
    const { kube, controller: runtime } = controller(["image", "independent"]);
    runtime.beforeStop = legacyRecoverySwitchGuard({
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
        saved.push("saved");
      },
    });
    // Second needs a GPU, so the idle image worker would stop; its unsaved legacy job holds it.
    await assert.rejects(runtime.acquire("second"), /legacy generations/);
    phase = "running";
    (await runtime.acquire("image")).release();
    (await runtime.acquire("independent")).release();
    await assert.rejects(runtime.acquire("second"), /legacy generations/);
    phase = "done";
    await assert.rejects(runtime.acquire("second"), /storage is full/);
    assert.deepEqual(kube.log, []);
    saveFails = false;
    await assert.rejects(runtime.acquire("second"), /Waiting for second to start/);
    await runtime.settled;
    assert.deepEqual(saved, ["saved"]);
    assert.deepEqual(kube.log, ["scale gpu/image 0", "gone gpu/image", "scale gpu/second 1"]);
    (await runtime.acquire("second")).release();
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

test("a known legacy operation on another worker does not block a switch", async () => {
  const { kube, controller: runtime } = controller(["image", "independent"]);
  runtime.beforeStop = legacyRecoverySwitchGuard({
    ids: ["video-job"],
    recover: async () => {},
    inspect: () => ({ backendUrl: workloads[1].url, settled: false }),
    save: async () => {
      throw new Error("Independent output must not be saved by this switch");
    },
  });
  await assert.rejects(runtime.acquire("second"), /Waiting for second to start/);
  await runtime.settled;
  assert.deepEqual(kube.log, ["scale gpu/image 0", "gone gpu/image", "scale gpu/second 1"]);
});
