import assert from "node:assert/strict";
import test from "node:test";

delete process.env.STUDIO_WORKERS;
const {
  deploymentWorkers,
  normalizeWorker,
  normalizeWorkerUrl,
  pickWorker,
  listWorkers,
  reloadWorkers,
  defaultWorkerId,
  modelLibraryWorker,
  noWorkerMessage,
  WorkerConfigError,
} = await import("./workers.js");

const reset = (environment = {}) => {
  delete process.env.STUDIO_WORKERS;
  Object.assign(process.env, environment);
  return reloadWorkers();
};

test("addresses are plain HTTP(S) origins", () => {
  assert.equal(normalizeWorkerUrl("8188"), "http://127.0.0.1:8188");
  assert.equal(normalizeWorkerUrl("comfy.local:8188/"), "http://comfy.local:8188");
  assert.equal(normalizeWorkerUrl("https://gpu.example/comfy/"), "https://gpu.example/comfy");
  for (const bad of ["", "ftp://x", "http://user:pass@x", "http://x/?a=1", "http://x/#f"])
    assert.equal(normalizeWorkerUrl(bad), "", bad);
});

test("STUDIO_WORKERS defines any number of locked workers with their capabilities", () => {
  const environment = {
    STUDIO_WORKERS: JSON.stringify([
      {
        id: "gpu0",
        name: "Images",
        url: "http://comfyui-image:8188",
        capabilities: ["image", "upscale", "models"],
      },
      { name: "Videos", url: "comfyui-video:8188", capabilities: "video" },
      { name: "Upscaler", url: "http://upscale:8188", capabilities: ["upscale"] },
    ]),
  };
  const list = deploymentWorkers(environment);
  assert.deepEqual(
    list.map((worker) => [worker.id, worker.url, worker.capabilities]),
    [
      ["gpu0", "http://comfyui-image:8188", ["image", "upscale", "models"]],
      ["videos", "http://comfyui-video:8188", ["video"]],
      ["upscaler", "http://upscale:8188", ["upscale"]],
    ],
  );
  assert.deepEqual(deploymentWorkers({ STUDIO_WORKERS: "[]" }), []);
});

test("without STUDIO_WORKERS, the image and video workloads give one worker per address", () => {
  const workload = (id, kind, url, extra = {}) => ({
    id,
    kind,
    namespace: kind,
    deployment: kind,
    pool: "gpu",
    gpus: 1,
    url,
    ...extra,
  });
  const workloads = [
    workload("comfyui", "image", "http://comfyui:8188", {
      worker: "primary",
      capabilities: ["image", "upscale", "models"],
    }),
    workload("comfyui-video", "video", "http://comfyui-video:8188/", { worker: "video" }),
    workload("comfyui-video-tp2", "video", "http://comfyui-video:8188", { gpus: 2 }),
    workload("text-qwen", "text", "http://qwen:8000", { model: "local/auto" }),
  ];
  const list = deploymentWorkers({}, workloads);
  assert.deepEqual(list, [
    {
      id: "primary",
      name: "Image Worker",
      url: "http://comfyui:8188",
      capabilities: ["image", "upscale", "models"],
    },
    {
      id: "video",
      name: "Video Worker",
      url: "http://comfyui-video:8188",
      capabilities: ["video"],
    },
  ]);
  const listed = [{ id: "local", url: "http://local:8188", capabilities: ["image"] }];
  assert.deepEqual(
    deploymentWorkers({ STUDIO_WORKERS: JSON.stringify(listed) }, workloads).map(
      (worker) => worker.id,
    ),
    ["local"],
    "STUDIO_WORKERS, when set, lists them instead",
  );
});

test("STUDIO_WORKERS refuses what it can't use, plainly", () => {
  for (const [value, pattern] of [
    ["not json", /JSON list/],
    ["{}", /JSON list/],
    ['[{"url":"http://a:1"}]', /at least one capability/],
    ['[{"url":"http://a:1","capabilities":["gpu"]}]', /unknown capability: gpu/],
    ['[{"capabilities":["image"]}]', /HTTP\(S\) address/],
    [
      '[{"id":"a","url":"http://a:1","capabilities":["image"]},{"id":"a","url":"http://b:1","capabilities":["video"]}]',
      /reuses the id/,
    ],
    ['[{"id":"Bad Id","url":"http://a:1","capabilities":["image"]}]', /invalid id/],
  ])
    assert.throws(
      () => deploymentWorkers({ STUDIO_WORKERS: value }),
      (error) => error instanceof WorkerConfigError && pattern.test(error.message),
      value,
    );
});

test("the deployment's workers are listed in order, Model Library included", () => {
  reset({
    STUDIO_WORKERS: JSON.stringify([
      { id: "primary", url: "http://127.0.0.1:8000", capabilities: ["image", "upscale"] },
      { name: "Video Box", url: "http://video-box:8188", capabilities: ["video", "models"] },
    ]),
  });
  assert.deepEqual(
    listWorkers().map((worker) => worker.id),
    ["primary", "video-box"],
  );
  assert.equal(defaultWorkerId(), "primary");
  assert.equal(modelLibraryWorker().id, "video-box");
});

test("zero workers is a valid setup with a plain message", () => {
  reset({ STUDIO_WORKERS: "[]" });
  assert.deepEqual(listWorkers(), []);
  assert.equal(defaultWorkerId(), "");
  assert.match(noWorkerMessage("image"), /No workers are set up/);
  assert.deepEqual(reset(), []);
});

test("routing: only capable workers, an online one with the model first, then list order", () => {
  const list = [
    { id: "a", capabilities: ["image"] },
    { id: "b", capabilities: ["image", "upscale"] },
    { id: "c", capabilities: ["video"] },
    { id: "d", capabilities: ["image"] },
  ];
  const online = (map) => (id) => (id in map ? map[id] : null);
  assert.equal(pickWorker("image", { workers: list }).id, "a");
  assert.equal(pickWorker("video", { workers: list }).id, "c");
  assert.equal(pickWorker("upscale", { workers: list }).id, "b");
  assert.equal(pickWorker("models", { workers: list }), null);
  assert.equal(pickWorker("image", { workers: [] }), null);
  // The first online capable worker, in list order.
  assert.equal(
    pickWorker("image", { workers: list, online: online({ a: false, b: true, d: true }) }).id,
    "b",
  );
  // An online worker that already has the model beats list order.
  assert.equal(
    pickWorker("image", {
      workers: list,
      online: online({ a: true, b: true, d: true }),
      hasModel: (id) => id === "d",
    }).id,
    "d",
  );
  // ...but never an offline one over an online one.
  assert.equal(
    pickWorker("image", {
      workers: list,
      online: online({ a: true, d: false }),
      hasModel: (id) => id === "d",
    }).id,
    "a",
  );
  // Smart upscale prefers a worker that can also upscale.
  assert.equal(pickWorker("image", { workers: list, prefers: ["upscale"] }).id, "b");
  // With none online, the first capable one still answers (its own error says why).
  assert.equal(pickWorker("image", { workers: list, online: () => false }).id, "a");
});

test("names, ids and capabilities are tidied", () => {
  const taken = new Set(["image-worker"]);
  const worker = normalizeWorker(
    { name: "  Image   Worker ", url: "gpu:8188", capabilities: ["VIDEO", "image"] },
    { taken },
  );
  assert.notEqual(worker.id, "image-worker");
  assert.match(worker.id, /^image-worker-[0-9a-f]{6}$/);
  assert.equal(worker.name, "Image Worker");
  assert.deepEqual(worker.capabilities, ["image", "video"]);
  assert.equal(normalizeWorker({ url: "x:1", capabilities: ["upscale"] }).name, "Upscale Worker");
});
