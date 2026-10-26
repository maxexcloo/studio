import assert from "node:assert/strict";
import test from "node:test";
import {
  DockerEngine,
  RuntimeController,
  type RuntimeEngine,
  type Workload,
} from "./controller.ts";

const workloads: Workload[] = [
  {
    id: "image",
    container: "studio-image",
    devices: ["0"],
    kind: "media",
    url: "http://worker:8188",
  },
  {
    id: "text",
    container: "studio-text",
    devices: ["0"],
    kind: "text",
    url: "http://radiance:8000",
  },
  {
    id: "video",
    container: "studio-video",
    devices: ["1"],
    kind: "media",
    url: "http://video:8188",
  },
];
function fixture(running = ["studio-image"]) {
  const active = new Set(running);
  const operations: string[] = [];
  const engine: RuntimeEngine = {
    running: async (id) => active.has(id),
    start: async (id) => {
      operations.push(`start:${id}`);
      active.add(id);
    },
    stop: async (id) => {
      operations.push(`stop:${id}`);
      active.delete(id);
    },
  };
  return { engine, operations };
}

test("observation mode never switches offline workers", async () => {
  const { engine, operations } = fixture();
  const controller = new RuntimeController(engine, workloads);
  await assert.rejects(controller.acquire("text"), /disabled/);
  assert.deepEqual(operations, []);
});

test("disagreeing running placements refuse admission without stopping either runtime", async () => {
  const { engine, operations } = fixture(["studio-image", "studio-text"]);
  const controller = new RuntimeController(engine, workloads, true);
  await assert.rejects(controller.acquire("image"), /Conflicting workers are running/);
  assert.deepEqual(operations, []);
});

test("saving output blocks conflicting switch while independent GPU work proceeds", async () => {
  const { engine, operations } = fixture();
  const controller = new RuntimeController(engine, workloads, true);
  const image = await controller.acquire("image");
  await assert.rejects(controller.acquire("text"), /saved outputs/);
  const video = await controller.acquire("video");
  image.release();
  image.release();
  const text = await controller.acquire("text");
  assert.deepEqual(operations, ["start:studio-video", "stop:studio-image", "start:studio-text"]);
  assert.equal(controller.status().find((item) => item.id === "video")?.acceptedOperations, 1);
  text.release();
  video.release();
  assert.ok(controller.status().every((item) => item.acceptedOperations === 0));
});

test("all text streams drain before media may switch", async () => {
  const { engine } = fixture(["studio-text"]);
  const controller = new RuntimeController(engine, workloads, true);
  const first = await controller.acquire("text");
  const second = await controller.acquire("text");
  first.release();
  await assert.rejects(controller.acquire("image"), /saved outputs/);
  second.release();
  (await controller.acquire("image")).release();
});

test("an independent GPU can be admitted while another worker health check is pending", async () => {
  const { engine } = fixture(["studio-image", "studio-video"]);
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let finishHealth: () => void = () => {};
  const health = new Promise<void>((resolve) => {
    finishHealth = resolve;
  });
  engine.ready = async (workload) => {
    if (workload.id === "image") {
      markStarted();
      await health;
    }
    return true;
  };
  const controller = new RuntimeController(engine, workloads);
  const image = controller.acquire("image");
  await started;
  const video = await controller.acquire("video");
  assert.equal(video.workload.id, "video");
  finishHealth();
  (await image).release();
  video.release();
});

test("failed startup frees controller admission without touching independent work", async () => {
  const { engine, operations } = fixture(["studio-video"]);
  engine.start = async () => {
    throw new Error("startup failed");
  };
  const controller = new RuntimeController(engine, workloads, true);
  await assert.rejects(controller.acquire("image"), /startup failed/);
  (await controller.acquire("video")).release();
  assert.deepEqual(operations, []);
});

test("restoring accepted jobs protects their resources without contacting the Engine", async () => {
  const { engine, operations } = fixture(["studio-image"]);
  engine.running = async () => {
    throw new Error("Engine is temporarily offline");
  };
  const controller = new RuntimeController(engine, workloads, true);
  const restored = controller.retain("image");
  assert.equal(controller.status()[0].acceptedOperations, 1);
  await assert.rejects(controller.acquire("text"), /saved outputs/);
  assert.deepEqual(operations, []);
  restored.release();
  assert.equal(controller.status()[0].acceptedOperations, 0);
});

test("Docker client targets configured Engine only and keeps provider errors out of response", async () => {
  const calls: string[] = [];
  const engine = new DockerEngine("http://engine:2375", (async (url, options) => {
    calls.push(`${options?.method} ${url}`);
    return new Response(
      options?.method === "GET" ? JSON.stringify({ State: { Running: true } }) : null,
      { status: 200 },
    );
  }) as typeof fetch);
  assert.equal(await engine.running("studio image"), true);
  await engine.stop("studio image");
  assert.deepEqual(calls, [
    "GET http://engine:2375/containers/studio%20image/json",
    "POST http://engine:2375/containers/studio%20image/stop?t=60",
  ]);
  const unavailable = new DockerEngine(
    "http://engine",
    (async () => new Response("secret provider detail", { status: 500 })) as typeof fetch,
  );
  await assert.rejects(unavailable.start("worker"), {
    message: "Docker could not complete the worker operation.",
  });
});
