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
  workload("text", "text", "text"),
  workload("gaming", "text", "text", 1, "gaming"),
];

function fixture(
  running: string[],
  {
    automaticLifecycle = false,
    store,
  }: { automaticLifecycle?: boolean; store?: RuntimeStore } = {},
) {
  const kube = fakeKubernetes(
    workloads.map((item) => ({
      namespace: item.namespace,
      name: item.deployment,
      replicas: running.includes(item.id) ? 1 : 0,
    })),
  );
  let clock = Date.parse("2026-10-27T00:00:00Z");
  const controller = new RuntimeController({
    engine: new KubernetesEngine(kube.request),
    workloads,
    pools: { gpu: 2, gaming: 1 },
    automaticLifecycle,
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
  return { kube, controller };
}

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
  assert.equal((await controller.observe()).desired?.join(), "video-tp2,gaming");
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

test("generation waits on a stopped workload: off says so, automatic starts it in place of an idle holder", async () => {
  const manual = fixture(["image"]);
  await assert.rejects(
    manual.controller.acquire("text"),
    /offline; automatic lifecycle control is disabled/,
  );
  assert.deepEqual(manual.kube.log, []);
  const { kube, controller } = fixture(["image", "video"], { automaticLifecycle: true });
  const busy = await controller.acquire("video");
  await assert.rejects(controller.acquire("text"), { message: "Waiting for Text to start." });
  await assert.rejects(
    controller.acquire("text"),
    /Text to start after the current runtime change/,
  );
  await controller.settled;
  assert.deepEqual(kube.log, ["scale comfyui/image 0", "gone comfyui/image", "scale text/text 1"]);
  (await controller.acquire("text")).release();
  busy.release();
  // Two-GPU video and one-GPU video share an address; whichever runs serves it.
  (await controller.acquire(["video", "video-tp2"])).release();
});

test("a deployment reset outside Studio shows as drift and automatic control restores it", async () => {
  const { kube, controller } = fixture(["image"], { automaticLifecycle: true });
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
    "automatic: restoring the last placement",
  );
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
  lease.release();
  await first.controller.settled;
});
