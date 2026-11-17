import assert from "node:assert/strict";
import test from "node:test";

import { fakeKubernetes } from "../fixtures/fake-kubernetes.ts";
import { RuntimeController, type RuntimeStore, type Workload } from "./controller.ts";
import { KubernetesEngine } from "./kubernetes.ts";

const workload = (
  id: string,
  kind: Workload["kind"],
  namespace: string,
  gpus = 1,
  pool = "gpu",
): Workload => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
  kind,
  namespace,
  deployment: id,
  pool,
  gpus,
  url: `http://${id}.invalid`,
});
const workloads = [
  workload("image", "image", "comfyui"),
  workload("video", "video", "comfyui-video"),
  workload("video-tp2", "video", "comfyui-video", 2),
  // Workloads that also serve local text.
  { ...workload("text", "image", "text"), capabilities: ["image", "text"] },
  { ...workload("gaming", "image", "text", 1, "gaming"), capabilities: ["image", "text"] },
];

const radiance: Workload = {
  ...workload("radiance", "image", "radiance", 2),
  backend: "radiance",
};

function fixture(
  running: string[],
  {
    store,
    withRadiance = false,
  }: {
    store?: RuntimeStore;
    withRadiance?: boolean;
  } = {},
) {
  const configured = withRadiance ? [...workloads, radiance] : workloads;
  const kube = fakeKubernetes(
    configured.map((item) => ({
      namespace: item.namespace,
      name: item.deployment,
      replicas: running.includes(item.id) ? 1 : 0,
    })),
  );
  let clock = Date.parse("2026-10-27T00:00:00Z");
  const controller = new RuntimeController({
    engine: new KubernetesEngine(kube.request),
    workloads: configured,
    pools: { gpu: 2, gaming: 1 },
    ...(store ? { store } : {}),
    now: () => clock,
    // Each poll lets the fake cluster move one step and the test act in between.
    sleep: async (ms) => {
      clock += ms;
      kube.tick();
      await new Promise((resolve) => setImmediate(resolve));
    },
    timeouts: { drain: 60 * 60_000, stop: 60_000, start: 60_000 },
  });
  return { kube, controller, advance: (ms: number) => (clock += ms) };
}

/** A store a test can read, which a controller "lost in a restart" no longer writes. */
function sharedStore() {
  let saved: unknown;
  return (writes = () => true): RuntimeStore => ({
    read: () => (saved ? structuredClone(saved) : undefined) as never,
    write: (record) => {
      if (writes()) saved = structuredClone(record);
    },
  });
}
const placeByHand = async (controller: RuntimeController, ids: string[]) => {
  const preview = await controller.preview(ids);
  await controller.apply(ids, preview.signature, "account:admin");
  await controller.settled;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("status reports phases, GPU use and why a pod is not ready", async () => {
  const { kube, controller } = fixture(["image", "text"]);
  kube.deployments.get("text/gaming")!.unschedulable =
    "0/3 nodes are available: cannot allocate all claims.";
  kube.deployments.get("text/gaming")!.replicas = 1;
  kube.tick();
  kube.denied.add("comfyui-video");
  const status = await controller.observe();
  assert.deepEqual(status.pools, [
    { id: "gpu", capacity: 2, used: 2 },
    { id: "gaming", capacity: 1, used: 1 },
  ]);
  const phases = Object.fromEntries(status.workloads.map((item) => [item.id, item.phase]));
  assert.deepEqual(phases, {
    image: "running",
    video: "unknown",
    "video-tp2": "unknown",
    text: "running",
    gaming: "starting",
  });
  assert.match(
    status.workloads.find((item) => item.id === "gaming")!.reason!,
    /^Waiting for a GPU: 0\/3 nodes are available/,
  );
  assert.match(
    status.workloads.find((item) => item.id === "video")!.reason!,
    /may not read comfyui-video\/video; apply Studio's runtime role in comfyui-video/,
  );
});

test("a two-GPU start stops both holders and waits for their pods to go before scaling up", async () => {
  const { kube, controller } = fixture(["image", "text", "gaming"]);
  const preview = await controller.preview(["video-tp2", "gaming"]);
  assert.deepEqual(
    { stop: preview.stop, start: preview.start, keep: preview.keep },
    { stop: ["image", "text"], start: ["video-tp2"], keep: ["gaming"] },
  );
  const operation = await controller.apply(
    ["video-tp2", "gaming"],
    preview.signature,
    "account:admin",
  );
  assert.equal(operation.status, "running");
  await controller.settled;
  assert.deepEqual(kube.log, [
    "scale comfyui/image 0",
    "scale text/text 0",
    "gone comfyui/image",
    "gone text/text",
    "scale comfyui-video/video-tp2 1",
  ]);
  const recorded = controller.operation(operation.id);
  assert.equal(recorded.status, "completed");
  assert.equal(recorded.requestedBy, "account:admin");
  assert.deepEqual(recorded.before, ["image", "text", "gaming"]);
  assert.deepEqual(recorded.after, ["video-tp2", "gaming"]);
  assert.ok(recorded.finishedAt! > recorded.startedAt);
  assert.ok(
    recorded.steps.some((step) =>
      /Waiting for Image, Text to release their GPUs/.test(step.message),
    ),
  );
});

test("previews are complete, checked against capacity and stale signatures are refused", async () => {
  const { kube, controller } = fixture(["image"]);
  await assert.rejects(
    controller.preview(["video-tp2", "text"]),
    /gpu pool has 2 GPUs; this placement needs 3/,
  );
  await assert.rejects(controller.preview(["missing"]), /missing is not a configured workload/);
  const preview = await controller.preview(["image", "text"]);
  kube.deployments.get("comfyui-video/video")!.replicas = 1;
  kube.tick();
  await assert.rejects(controller.apply(["image", "text"], preview.signature, "local"), {
    status: 409,
    message: /changed since this preview/,
  });
  assert.deepEqual(kube.log, []);
});

test("one change at a time: a second apply or restart is refused while one runs", async () => {
  const { controller } = fixture(["image"]);
  const lease = await controller.acquire("image");
  const preview = await controller.preview(["text"]);
  await controller.apply(["text"], preview.signature, "local");
  await assert.rejects(controller.apply(["text"], preview.signature, "local"), {
    status: 409,
    message: /Another runtime change is running/,
  });
  await assert.rejects(controller.restart("image", "local"), /Another runtime change is running/);
  lease.release();
  await controller.settled;
});

test("accepted work drains before its workload stops, and new work on it waits", async () => {
  const { kube, controller } = fixture(["image", "video"]);
  const lease = await controller.acquire("image");
  const preview = await controller.preview(["text", "video"]);
  const operation = await controller.apply(["text", "video"], preview.signature, "local");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(
    controller.operation(operation.id).progress,
    /Waiting for 1 accepted operation on Image/,
  );
  await assert.rejects(
    controller.acquire("image"),
    /Waiting for the runtime change to finish before using Image/,
  );
  // Independent work keeps running during the change.
  (await controller.acquire("video")).release();
  assert.deepEqual(kube.log, []);
  lease.release();
  await controller.settled;
  assert.deepEqual(kube.log.slice(0, 3), [
    "scale comfyui/image 0",
    "gone comfyui/image",
    "scale text/text 1",
  ]);
  (await controller.acquire("text")).release();
});

test("a start that cannot get its GPU fails with Kubernetes' reason and frees admission", async () => {
  const { kube, controller } = fixture(["image"]);
  kube.deployments.get("text/gaming")!.unschedulable =
    "0/3 nodes are available: 1 Insufficient GPU.";
  const preview = await controller.preview(["image", "gaming"]);
  const operation = await controller.apply(["image", "gaming"], preview.signature, "local");
  await controller.settled;
  const failed = controller.operation(operation.id);
  assert.equal(failed.status, "failed");
  assert.match(
    failed.error!,
    /^Waiting for Gaming: Waiting for a GPU: 0\/3 nodes are available: 1 Insufficient GPU\. Gave up after 1 minute\.$/,
  );
  (await controller.acquire("image")).release();
});

test("restart scales to zero, waits for the pod to go and scales back; a stopped workload is refused", async () => {
  const { kube, controller } = fixture(["text"]);
  await assert.rejects(controller.restart("image", "local"), /Image is not running/);
  const operation = await controller.restart("text", "control-mcp");
  await controller.settled;
  assert.deepEqual(kube.log, ["scale text/text 0", "gone text/text", "scale text/text 1"]);
  const recorded = controller.operation(operation.id);
  assert.equal(recorded.type, "restart");
  assert.equal(recorded.status, "completed");
  assert.deepEqual(recorded.after, ["text"]);
});

test("generation waits on a stopped workload and starts nothing", async () => {
  const { kube, controller } = fixture(["image", "video"]);
  await assert.rejects(controller.acquire("video-tp2"), {
    status: 503,
    message: "Video-tp2 is stopped: an administrator can start it in Settings › Workers.",
  });
  await assert.rejects(controller.acquire("text"), /Text is stopped/);
  await controller.reconcile();
  assert.deepEqual(kube.log, []);
  assert.deepEqual((await controller.observe()).history, []);
  assert.deepEqual([...(await controller.parked())], ["video-tp2", "text", "gaming"]);
  // Two-GPU video and one-GPU video share an address; whichever runs serves it.
  (await controller.acquire(["video-tp2", "video"])).release();
});

test("a change doesn't wait on work for a workload without pods, and an administrator can stop it", async () => {
  const { kube, controller } = fixture(["image", "video"]);
  controller.retain("image");
  // Something outside Studio scales the workload down, leaving its recovered lease behind.
  kube.deployments.get("comfyui/image")!.replicas = 0;
  for (const pod of kube.deployments.get("comfyui/image")!.pods) pod.deleting = true;
  kube.tick();
  kube.log.length = 0;
  const lease = await controller.acquire("video");
  const preview = await controller.preview(["text"]);
  const operation = await controller.apply(["text"], preview.signature, "local");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(controller.operation(operation.id).progress, /accepted operation on Video/);
  controller.cancel(operation.id, "account:admin");
  await controller.settled;
  const stopped = controller.operation(operation.id);
  assert.equal(stopped.error, "Cancelled by account:admin.");
  assert.deepEqual(kube.log, []);
  // The cancelled target isn't restored as if it had been stopped outside Studio.
  await controller.reconcile();
  assert.equal((await controller.observe()).history.length, 1);
  assert.throws(() => controller.cancel(operation.id, "account:admin"), /no longer running/);
  lease.release();
});

test("an administrator's apply can stop a workload serving text for media", async () => {
  const { kube, controller } = fixture(["text"]);
  const preview = await controller.preview(["video-tp2"]);
  assert.deepEqual(preview.stop, ["text"]);
  await controller.apply(["video-tp2"], preview.signature, "account:admin");
  await controller.settled;
  assert.deepEqual(kube.log, [
    "scale text/text 0",
    "gone text/text",
    "scale comfyui-video/video-tp2 1",
  ]);
  (await controller.acquire("video-tp2")).release();
});

test("an explicit start uses a free GPU, else names what it stops", async () => {
  const { kube, controller } = fixture(["image", "text"]);
  const preview = await controller.previewStart(["video-tp2"]);
  assert.deepEqual(
    [preview.target, preview.stop, preview.start],
    [["video-tp2"], ["image", "text"], ["video-tp2"]],
  );
  assert.deepEqual((await controller.previewStart(["gaming"])).stop, []);
  // A running candidate needs nothing; otherwise the first that fits beside what runs starts.
  assert.deepEqual((await controller.previewStart(["gaming", "text"])).start, []);
  const media = fixture(["image", "video"]).controller;
  const replace = await media.previewStart(["text"]);
  assert.deepEqual([replace.stop, replace.start], [["image"], ["text"]]);
  const free = fixture(["image"]).controller;
  const fits = await free.previewStart(["video-tp2", "video"]);
  assert.deepEqual([fits.stop, fits.start], [[], ["video"]]);
  await assert.rejects(controller.previewStart([]), { status: 400 });
  assert.deepEqual(kube.log, []);
});

test("a deployment reset outside Studio shows as drift and is restored", async () => {
  const { kube, controller } = fixture(["image"]);
  const preview = await controller.preview(["image", "text"]);
  await controller.apply(["image", "text"], preview.signature, "local");
  await controller.settled;
  // A Flux upgrade forces replicas to 0.
  kube.deployments.get("text/text")!.replicas = 0;
  for (const pod of kube.deployments.get("text/text")!.pods) pod.deleting = true;
  kube.tick();
  const status = await controller.observe();
  assert.equal(
    status.workloads.find((item) => item.id === "text")!.reason,
    "Stopped outside Studio; its last placement had it running.",
  );
  await controller.reconcile();
  await controller.settled;
  assert.equal(kube.log.at(-1), "scale text/text 1");
  assert.equal(status.history.length, 1);
  assert.equal(
    (await controller.observe()).history[0].requestedBy,
    "restoring the last placement after an outside stop",
  );
});

test("work queued after an outside stop waits while the whole placement is restored", async () => {
  const { kube, controller } = fixture(["image"]);
  const preview = await controller.preview(["image", "video"]);
  await controller.apply(["image", "video"], preview.signature, "local");
  await controller.settled;
  // A release upgrades the worker chart, which forces both to 0 before reconcile runs.
  for (const id of ["comfyui/image", "comfyui-video/video"]) {
    kube.deployments.get(id)!.replicas = 0;
    for (const pod of kube.deployments.get(id)!.pods) pod.deleting = true;
  }
  kube.tick();
  await assert.rejects(controller.acquire("video"), {
    message: "Video stopped outside Studio; Studio restores it once its GPUs are free.",
  });
  await controller.reconcile();
  await controller.settled;
  const [restored] = (await controller.observe()).history;
  assert.deepEqual([restored.target, restored.stop], [["image", "video"], []]);
  (await controller.acquire("video")).release();
});

test("history survives a restart and a change cut short is marked interrupted", async () => {
  let saved: unknown;
  const store: RuntimeStore = {
    read: () => (saved ? structuredClone(saved) : undefined) as never,
    write: (record) => (saved = structuredClone(record)),
  };
  const first = fixture(["image"], { store });
  const lease = await first.controller.acquire("image");
  const preview = await first.controller.preview(["text"]);
  const operation = await first.controller.apply(["text"], preview.signature, "local");
  // Studio restarts while the change waits for accepted work.
  const second = fixture(["image"], { store });
  const recorded = second.controller.operation(operation.id);
  assert.equal(recorded.status, "interrupted");
  assert.equal(recorded.error, "Studio restarted during this change.");
  assert.deepEqual(recorded.before, ["image"]);
  assert.deepEqual(recorded.target, ["text"]);
  // It stopped nothing, so the placement is still what ran.
  await second.controller.reconcile();
  assert.equal((await second.controller.observe()).history.length, 1);
  lease.release();
  await first.controller.settled;
});

test("waiting ComfyUI work swaps Radiance out after its accepted work, and Radiance returns when idle", async () => {
  const { kube, controller, advance } = fixture(["radiance"], { withRadiance: true });
  await placeByHand(controller, ["radiance"]);
  assert.equal((await controller.observe()).swaps, "automatic");
  const accepted = await controller.acquire("radiance");
  await assert.rejects(controller.acquire("image"), {
    status: 503,
    message: "Waiting for Image — Studio is switching the GPUs.",
  });
  await settle();
  // Nothing stops while Radiance's accepted work runs, and new Radiance work waits for the swap.
  assert.match((await controller.observe()).operation!.progress, /accepted operation on Radiance/);
  await assert.rejects(controller.acquire("radiance"), /Waiting for the runtime change to finish/);
  assert.deepEqual(kube.log, []);
  accepted.release();
  await controller.settled;
  assert.deepEqual(kube.log, [
    "scale radiance/radiance 0",
    "gone radiance/radiance",
    "scale comfyui/image 1",
  ]);
  assert.equal(
    (await controller.observe()).history[0].requestedBy,
    "automatic: switching to Image for waiting ComfyUI work",
  );
  (await controller.acquire("image")).release();
  await assert.rejects(controller.acquire("radiance"), {
    message: "Waiting for Radiance — Studio switches the GPUs back once the ComfyUI work finishes.",
  });
  // Not yet idle for two minutes: the swap stays.
  advance(60_000);
  await controller.swapOnDemand();
  assert.equal((await controller.observe()).operation, undefined);
  advance(60_000);
  await controller.swapOnDemand();
  await controller.settled;
  assert.deepEqual(kube.log.slice(3), [
    "scale comfyui/image 0",
    "gone comfyui/image",
    "scale radiance/radiance 1",
  ]);
  const status = await controller.observe();
  assert.match(status.history[0].requestedBy, /^automatic: back to Radiance after 2 minutes/);
  assert.equal(status.swaps, "automatic");
  (await controller.acquire("radiance")).release();
});

test("a placement by hand without Radiance pauses swaps until Radiance is placed again", async () => {
  // As the live record holds a conversion window: an apply of ComfyUI alone.
  const store = sharedStore()();
  store.write({ desired: ["image"], operations: [] });
  const { kube, controller } = fixture(["image"], { withRadiance: true, store });
  assert.equal((await controller.observe()).swaps, "paused");
  await assert.rejects(controller.acquire("video-tp2"), {
    message: "Video-tp2 is stopped: an administrator can start it in Settings › Workers.",
  });
  await controller.swapOnDemand();
  await controller.reconcile();
  assert.deepEqual(kube.log, []);
  await placeByHand(controller, ["radiance"]);
  assert.equal((await controller.observe()).swaps, "automatic");
});

test("a Studio restart mid-swap keeps the swap, restores it and still returns to Radiance", async () => {
  const shared = sharedStore();
  let firstAlive = true;
  const first = fixture(["radiance"], { withRadiance: true, store: shared(() => firstAlive) });
  await placeByHand(first.controller, ["radiance"]);
  await assert.rejects(first.controller.acquire("image"), /Studio is switching the GPUs/);
  while (!first.kube.log.includes("scale radiance/radiance 0")) await settle();
  firstAlive = false;
  // Studio restarts after stopping Radiance, before Image has started.
  const second = fixture([], { withRadiance: true, store: shared() });
  const status = await second.controller.observe();
  assert.equal(status.history[0].status, "interrupted");
  assert.equal(status.swaps, "automatic");
  await second.controller.reconcile();
  await second.controller.settled;
  assert.deepEqual(second.kube.log, ["scale comfyui/image 1"]);
  (await second.controller.acquire("image")).release();
  second.advance(2 * 60_000);
  await second.controller.swapOnDemand();
  await second.controller.settled;
  assert.deepEqual(second.kube.log.slice(1), [
    "scale comfyui/image 0",
    "gone comfyui/image",
    "scale radiance/radiance 1",
  ]);
  await first.controller.settled;
});

/**
 * A queue whose Radiance work holds `leases` until it ends; `stale` ones go when released. `tiers`
 * holds the highest tier waiting on each workload.
 */
function fakeQueue(stale: { release(): void }[] = []) {
  const leases: { release(): void }[] = [];
  const calls: string[] = [];
  const tiers = new Map<string, number>();
  return {
    leases,
    calls,
    tiers,
    queue: {
      waitingTier: (id: string) => tiers.get(id) ?? Infinity,
      load: (id: string) =>
        id === "radiance"
          ? {
              jobs: [
                {
                  id: "job-1",
                  title: "A lighthouse",
                  status: "running" as const,
                  since: "2026-10-27T00:00:00Z",
                },
              ],
              queued: 2,
            }
          : { jobs: [], queued: 0 },
      cancel: async (id: string) => {
        calls.push(`cancel ${id}`);
        return { cancelled: 2, cancelling: 1 };
      },
      releaseStale: () => {
        for (const lease of stale.splice(0)) lease.release();
      },
      end: async (id: string) => {
        calls.push(`end ${id}`);
        for (const lease of leases.splice(0)) lease.release();
      },
    },
  };
}

test("Radiance restarts without waiting for its work, which ends, and Cancel Queue reaches the queue", async () => {
  const { kube, controller } = fixture(["radiance"], { withRadiance: true });
  assert.throws(() => controller.cancelQueue("radiance"), { status: 503 });
  const { leases, calls, queue } = fakeQueue();
  controller.useQueue(queue);
  leases.push(await controller.acquire("radiance"));
  const status = (await controller.observe()).workloads.find((item) => item.id === "radiance")!;
  assert.deepEqual(
    [status.radiance, status.jobs?.[0].title, status.queued],
    [true, "A lighthouse", 2],
  );
  assert.deepEqual(await controller.cancelQueue("radiance"), { cancelled: 2, cancelling: 1 });
  assert.throws(() => controller.cancelQueue("missing"), { status: 400 });
  await assert.rejects(controller.restart("image", "local", true), {
    status: 400,
    message: "Only Radiance restarts without waiting for its work.",
  });
  const operation = await controller.restart("radiance", "account:admin", true);
  await controller.settled;
  assert.deepEqual(kube.log, [
    "scale radiance/radiance 0",
    "gone radiance/radiance",
    "scale radiance/radiance 1",
  ]);
  assert.deepEqual(calls, ["cancel radiance", "end radiance"]);
  assert.equal(controller.operation(operation.id).status, "completed");
  assert.equal(controller.status().find((item) => item.id === "radiance")!.acceptedOperations, 0);
});

test("a switch waiting on Radiance's work drops stale leases and stops waiting once Radiance is forced", async () => {
  const { kube, controller } = fixture(["radiance"], { withRadiance: true });
  await placeByHand(controller, ["radiance"]);
  const stale = await controller.acquire("radiance");
  const { leases, queue } = fakeQueue([stale]);
  controller.useQueue(queue);
  leases.push(await controller.acquire("radiance"));
  await assert.rejects(controller.acquire("image"), /Studio is switching the GPUs/);
  await settle();
  // The stale lease is gone; the job still running holds the switch.
  const running = (await controller.observe()).operation!;
  assert.match(running.progress, /^Waiting for 1 accepted operation on Radiance/);
  assert.deepEqual(kube.log, []);
  // Forcing joins the running switch rather than starting another change.
  assert.equal((await controller.restart("radiance", "account:admin", true)).id, running.id);
  await controller.settled;
  assert.deepEqual(kube.log, [
    "scale radiance/radiance 0",
    "gone radiance/radiance",
    "scale comfyui/image 1",
  ]);
  assert.equal(controller.operation(running.id).status, "completed");
});

test("a swap for ComfyUI work holds while Radiance has work of a higher tier waiting", async () => {
  const { kube, controller } = fixture(["radiance"], { withRadiance: true });
  await placeByHand(controller, ["radiance"]);
  const { tiers, queue } = fakeQueue();
  controller.useQueue(queue);
  const accepted = await controller.acquire("radiance");
  // MCP work waits for Image while manual work waits for Radiance.
  tiers.set("image", 1).set("radiance", 0);
  await assert.rejects(controller.acquire("image"), /Studio is switching the GPUs/);
  accepted.release();
  await settle();
  assert.equal(
    (await controller.observe()).operation!.progress,
    "Waiting for higher-priority work on Radiance first.",
  );
  const manual = await controller.acquire("radiance");
  tiers.set("radiance", 1);
  await settle();
  assert.match((await controller.observe()).operation!.progress, /accepted operation on Radiance/);
  // Work of the swap's own tier waits for it.
  await assert.rejects(controller.acquire("radiance"), /Waiting for the runtime change to finish/);
  assert.deepEqual(kube.log, []);
  manual.release();
  await controller.settled;
  assert.deepEqual(kube.log, [
    "scale radiance/radiance 0",
    "gone radiance/radiance",
    "scale comfyui/image 1",
  ]);
});
