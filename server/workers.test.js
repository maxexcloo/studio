import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-workers-"));
process.env.HEISS_DATA_DIR = dataDir;
for (const key of ["STUDIO_WORKERS", "COMFY_URL", "COMFY_VIDEO_URL", "HEISS_DEFAULT_COMFY_URL"]) delete process.env[key];
const workers = await import("./workers.js");
const { envFileKeys } = await import("./env.js");
const { deploymentWorkers, seedWorkers, normalizeWorker, normalizeWorkerUrl, pickWorker, listWorkers, reloadWorkers, saveWorkers, defaultWorkerId, modelLibraryWorker, noWorkerMessage, WorkerConfigError } = workers;

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const reset = (environment = {}) => {
  for (const key of ["STUDIO_WORKERS", "COMFY_URL", "COMFY_VIDEO_URL", "HEISS_DEFAULT_COMFY_URL"]) delete process.env[key];
  Object.assign(process.env, environment);
  fs.rmSync(workers.workersFile(), { force: true });
  fs.rmSync(`${workers.workersFile()}.bak`, { force: true });
  return reloadWorkers();
};

test("addresses are plain HTTP(S) origins", () => {
  assert.equal(normalizeWorkerUrl("8188"), "http://127.0.0.1:8188");
  assert.equal(normalizeWorkerUrl("comfy.local:8188/"), "http://comfy.local:8188");
  assert.equal(normalizeWorkerUrl("https://gpu.example/comfy/"), "https://gpu.example/comfy");
  for (const bad of ["", "ftp://x", "http://user:pass@x", "http://x/?a=1", "http://x/#f"]) assert.equal(normalizeWorkerUrl(bad), "", bad);
});

test("STUDIO_WORKERS defines any number of locked workers with their capabilities", () => {
  const environment = { STUDIO_WORKERS: JSON.stringify([
    { id: "gpu0", name: "Images", url: "http://comfyui-image:8188", capabilities: ["image", "upscale", "models"] },
    { name: "Videos", url: "comfyui-video:8188", capabilities: "video" },
    { name: "Upscaler", url: "http://upscale:8188", capabilities: ["upscale"] }
  ]), COMFY_URL: "http://ignored:8188" };
  const { variable, workers: list } = deploymentWorkers(environment);
  assert.equal(variable, "STUDIO_WORKERS");
  assert.deepEqual(list.map((worker) => [worker.id, worker.url, worker.capabilities]), [
    ["gpu0", "http://comfyui-image:8188", ["image", "upscale", "models"]],
    ["videos", "http://comfyui-video:8188", ["video"]],
    ["upscaler", "http://upscale:8188", ["upscale"]]
  ]);
  // STUDIO_WORKERS owns the whole list: nothing is seeded beside it.
  assert.deepEqual(seedWorkers(environment), []);
  assert.deepEqual(deploymentWorkers({ STUDIO_WORKERS: "[]" }).workers, []);
});

test("STUDIO_WORKERS refuses what it can't use, plainly", () => {
  for (const [value, pattern] of [
    ["not json", /JSON list/],
    ["{}", /JSON list/],
    ['[{"url":"http://a:1"}]', /at least one capability/],
    ['[{"url":"http://a:1","capabilities":["gpu"]}]', /unknown capability: gpu/],
    ['[{"capabilities":["image"]}]', /HTTP\(S\) address/],
    ['[{"id":"a","url":"http://a:1","capabilities":["image"]},{"id":"a","url":"http://b:1","capabilities":["video"]}]', /reuses the id/],
    ['[{"id":"Bad Id","url":"http://a:1","capabilities":["image"]}]', /invalid id/]
  ]) assert.throws(() => deploymentWorkers({ STUDIO_WORKERS: value }), (error) => error instanceof WorkerConfigError && pattern.test(error.message), value);
});

test("COMFY_URL and COMFY_VIDEO_URL seed the image and video workers with their old ids", () => {
  const both = deploymentWorkers({ COMFY_URL: "http://image:8188", COMFY_VIDEO_URL: "http://video:8188" });
  assert.deepEqual(both.workers.map((worker) => [worker.id, worker.name, worker.capabilities]), [
    ["primary", "Image Worker", ["image", "upscale", "models"]],
    ["video", "Video Worker", ["video"]]
  ]);
  // Without a video address, local video runs on the image worker, as before.
  assert.deepEqual(deploymentWorkers({ COMFY_URL: "http://image:8188" }).workers[0].capabilities, ["image", "video", "upscale", "models"]);
});

test("locked environment workers come first and can't be changed, removed or reused", () => {
  reset({ COMFY_URL: "http://deployed-image:8188" });
  assert.deepEqual(listWorkers().map((worker) => [worker.id, worker.source, worker.locked]), [["primary", "deployment", true]]);
  assert.throws(() => saveWorkers([{ id: "primary", name: "Image Worker", url: "http://elsewhere:8188", capabilities: ["image"] }]), /deployment configuration/);
  // Leaving a locked worker out of the list removes nothing; adding one beside it works.
  const saved = saveWorkers([{ name: "Spare Upscaler", url: "spare:8188", capabilities: ["upscale"] }]);
  assert.deepEqual(saved.map((worker) => [worker.id, worker.source, worker.locked]), [["primary", "deployment", true], ["spare-upscaler", "studio", false]]);
  assert.throws(() => saveWorkers([{ id: "primary", url: "http://x:1", name: "Image Worker", capabilities: ["image"] }, { id: "primary", name: "Copy", url: "http://y:1", capabilities: ["video"] }]), /deployment configuration|reuses/);
});

test("a fresh install seeds the local address; the first save is kept as is, never overwritten by the seed", () => {
  reset({ HEISS_DEFAULT_COMFY_URL: "http://host.docker.internal:8188" });
  assert.deepEqual(listWorkers().map((worker) => [worker.id, worker.url, worker.source, worker.locked]), [["primary", "http://host.docker.internal:8188", "default", false]]);
  assert.equal(fs.existsSync(workers.workersFile()), false, "seeding writes nothing");
  saveWorkers([
    { id: "primary", name: "Desk GPU", url: "http://127.0.0.1:8000", capabilities: ["image", "upscale"] },
    { name: "Video Box", url: "http://video-box:8188", capabilities: ["video", "models"] }
  ]);
  process.env.COMFY_URL = "http://from-dotenv:8188";
  // A later address in .env or the default no longer changes Studio's own list.
  envFileOnly("COMFY_URL", () => {
    const list = reloadWorkers();
    assert.deepEqual(list.map((worker) => [worker.id, worker.name, worker.url]), [["primary", "Desk GPU", "http://127.0.0.1:8000"], ["video-box", "Video Box", "http://video-box:8188"]]);
  });
  assert.equal(modelLibraryWorker().id, "video-box");
  assert.equal(JSON.parse(fs.readFileSync(workers.workersFile(), "utf8")).workers.length, 2);
});

test("zero workers is a valid setup with a plain message", () => {
  reset({ STUDIO_WORKERS: "[]" });
  assert.deepEqual(listWorkers(), []);
  assert.equal(defaultWorkerId(), "");
  assert.match(noWorkerMessage("image"), /No workers are set up/);
  reset({ HEISS_DEFAULT_COMFY_URL: "http://x:1" });
  saveWorkers([]);
  assert.deepEqual(reloadWorkers(), []);
});

test("routing: only capable workers, an online one with the model first, then list order", () => {
  const list = [
    { id: "a", capabilities: ["image"] },
    { id: "b", capabilities: ["image", "upscale"] },
    { id: "c", capabilities: ["video"] },
    { id: "d", capabilities: ["image"] }
  ];
  const online = (map) => (id) => (id in map ? map[id] : null);
  assert.equal(pickWorker("image", { workers: list }).id, "a");
  assert.equal(pickWorker("video", { workers: list }).id, "c");
  assert.equal(pickWorker("upscale", { workers: list }).id, "b");
  assert.equal(pickWorker("models", { workers: list }), null);
  assert.equal(pickWorker("image", { workers: [] }), null);
  // The first online capable worker, in list order.
  assert.equal(pickWorker("image", { workers: list, online: online({ a: false, b: true, d: true }) }).id, "b");
  // An online worker that already has the model beats list order.
  assert.equal(pickWorker("image", { workers: list, online: online({ a: true, b: true, d: true }), hasModel: (id) => id === "d" }).id, "d");
  // ...but never an offline one over an online one.
  assert.equal(pickWorker("image", { workers: list, online: online({ a: true, d: false }), hasModel: (id) => id === "d" }).id, "a");
  // Smart upscale prefers a worker that can also upscale.
  assert.equal(pickWorker("image", { workers: list, prefers: ["upscale"] }).id, "b");
  // With none online, the first capable one still answers (its own error says why).
  assert.equal(pickWorker("image", { workers: list, online: () => false }).id, "a");
});

test("names, ids and capabilities are tidied when saved", () => {
  const taken = new Set(["image-worker"]);
  const worker = normalizeWorker({ name: "  Image   Worker ", url: "gpu:8188", capabilities: ["VIDEO", "image"] }, { taken });
  assert.notEqual(worker.id, "image-worker");
  assert.match(worker.id, /^image-worker-[0-9a-f]{6}$/);
  assert.equal(worker.name, "Image Worker");
  assert.deepEqual(worker.capabilities, ["image", "video"]);
  assert.equal(normalizeWorker({ url: "x:1", capabilities: ["upscale"] }).name, "Upscale Worker");
});

/** Runs `check` as if `key` had come from Studio's .env (editable), not the deployment. */
function envFileOnly(key, check) {
  envFileKeys.add(key);
  try { check(); } finally { envFileKeys.delete(key); }
}
