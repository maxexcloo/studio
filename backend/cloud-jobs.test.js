import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-cloud-jobs-"));
process.env.STUDIO_DATA_DIR = dataDir;
const {
  cloudJobExpiryMs,
  cloudJobFailedMessage,
  cloudJobLostMessage,
  createCloudJobStore,
  isCloudGraph,
} = await import("./cloud-jobs.js");
const { createJobRecovery } = await import("./job-recovery.js");
const { recordsFromComfyHistory } = await import("./gallery-store.js");
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const owner = "account-1";
const grokGraph = {
  1: {
    class_type: "GrokMedia",
    inputs: { kind: "video", prompt: "An egg in a cup", width: 1280, height: 720 },
  },
};
const generation = (jobId) => ({
  jobId,
  ownerId: owner,
  prompt: "An egg in a cup",
  width: 1280,
  height: 720,
  settings: { profileId: "custom:grok-video", modelName: "grok-imagine-video-1.5" },
});
const promptEntry = (jobId) => [
  0,
  `${jobId}-prompt`,
  grokGraph,
  { studio_generation: generation(jobId) },
];

/** One Studio process: its own job map and cloud store over the shared file, against a stub ComfyUI that runs the Grok node. */
function studio(file, comfy, gallery) {
  const state = { gallery, jobs: new Map(), store: createCloudJobStore(file) };
  state.restored = state.store.restore(state.jobs, {
    live: (id) =>
      state.gallery.some(
        (item) => item.jobId === id && !item.url && ["pending", "error"].includes(item.status),
      ),
  });
  state.recover = createJobRecovery({
    backends: () => ["primary"],
    // As setTerminalJob does: every ending drops the cloud record.
    finishJob: (id, patch) => {
      state.jobs.set(id, { ...state.jobs.get(id), ...patch, terminalAt: 1 });
      state.store.forget(id);
    },
    getGallery: () => state.gallery,
    jobs: state.jobs,
    recordsFromHistory: recordsFromComfyHistory,
    request: async (url) => (url === "/queue" ? comfy.queue : comfy.history),
    setGallery: (items) => {
      state.gallery = items;
    },
    visible: (items) => items,
    withBackend: async (_backend, run) => run(),
  });
  return state;
}

function submit(file, jobId) {
  // What runJob writes once ComfyUI accepts the Grok prompt.
  assert.equal(isCloudGraph(grokGraph), true);
  createCloudJobStore(file).remember(jobId, {
    promptId: `${jobId}-prompt`,
    comfyBackend: "primary",
    kind: "video",
    profileId: "custom:grok-video",
    ownerId: owner,
  });
  return [
    {
      id: `${jobId}-0`,
      jobId,
      ownerId: owner,
      status: "pending",
      url: "",
      type: "video",
      prompt: "An egg in a cup",
    },
  ];
}

test("a Grok run accepted before a restart resumes and delivers its video to its owner", async () => {
  const file = path.join(dataDir, "deliver.json");
  const comfy = { queue: { queue_running: [promptEntry("grok-a")] }, history: {} };
  const gallery = submit(file, "grok-a");
  // Restart: nothing in memory survives, only the gallery and the cloud record on disk.
  const restarted = studio(file, comfy, gallery);
  assert.deepEqual(restarted.restored, ["grok-a"]);
  const live = restarted.jobs.get("grok-a");
  assert.equal(live.status, "running");
  assert.equal(live.ownerId, owner);
  assert.equal(live.promptId, "grok-a-prompt");

  await restarted.recover();
  assert.equal(restarted.gallery[0].status, "pending");
  assert.ok(fs.existsSync(file), "the record stays until the run ends");

  comfy.queue = {};
  comfy.history = {
    "grok-a-prompt": {
      prompt: promptEntry("grok-a"),
      outputs: { 1: { videos: [{ filename: "abc.mp4", subfolder: "grok", type: "output" }] } },
      status: { status_str: "success" },
    },
  };
  await restarted.recover();
  const [delivered, ...rest] = restarted.gallery;
  assert.equal(rest.length, 0, "the pending tile is replaced, not duplicated");
  assert.equal(delivered.status, "done");
  assert.equal(delivered.jobId, "grok-a");
  assert.equal(delivered.ownerId, owner);
  assert.match(delivered.url, /abc\.mp4/);
  assert.equal(restarted.jobs.get("grok-a").status, "done");
  assert.equal(fs.existsSync(file), false, "a delivered run leaves no record");
});

test("a provider failure reported after the restart fails the tile clearly", async () => {
  const file = path.join(dataDir, "failed.json");
  const comfy = {
    queue: {},
    history: {
      "grok-b-prompt": {
        prompt: promptEntry("grok-b"),
        outputs: {},
        status: {
          status_str: "error",
          messages: [
            [
              "execution_error",
              { exception_message: "CLIProxyAPI video failed; inspect provider health." },
            ],
          ],
        },
      },
    },
  };
  const restarted = studio(file, comfy, submit(file, "grok-b"));
  await restarted.recover();
  assert.equal(restarted.gallery[0].status, "error");
  assert.equal(restarted.gallery[0].error, cloudJobFailedMessage);
  assert.equal(restarted.jobs.get("grok-b").status, "error");
  assert.equal(fs.existsSync(file), false);
});

test("a run ComfyUI lost fails after two scans, or at once past the provider deadline", async () => {
  const file = path.join(dataDir, "lost.json");
  const comfy = { queue: {}, history: {} };
  const restarted = studio(file, comfy, submit(file, "grok-c"));
  await restarted.recover();
  assert.equal(restarted.gallery[0].status, "pending", "one empty scan is not proof");
  await restarted.recover();
  assert.equal(restarted.gallery[0].error, cloudJobLostMessage);
  assert.equal(fs.existsSync(file), false);

  const old = path.join(dataDir, "expired.json");
  const gallery = submit(old, "grok-d");
  const raw = JSON.parse(fs.readFileSync(old, "utf8"));
  raw["grok-d"].submittedAt = Date.now() - cloudJobExpiryMs - 1000;
  fs.writeFileSync(old, JSON.stringify(raw));
  const expired = studio(old, comfy, gallery);
  await expired.recover();
  assert.equal(expired.gallery[0].error, cloudJobFailedMessage);
  assert.equal(fs.existsSync(old), false);
});

test("records whose tile was delivered, cancelled or deleted are dropped on start", () => {
  const file = path.join(dataDir, "stale.json");
  submit(file, "grok-e");
  const restarted = studio(file, { queue: {}, history: {} }, [
    { id: "grok-e-0", jobId: "grok-e", status: "canceled", url: "" },
  ]);
  assert.deepEqual(restarted.restored, []);
  assert.equal(restarted.jobs.size, 0);
  assert.equal(fs.existsSync(file), false);
});

test("every terminal job state clears its cloud record", async () => {
  const { cloudJobs, setTerminalJob } = await import("./jobs.js");
  cloudJobs.remember("grok-f", { promptId: "grok-f-prompt", comfyBackend: "primary" });
  assert.ok(cloudJobs.all()["grok-f"]);
  setTerminalJob("grok-f", { status: "canceled" });
  assert.equal(cloudJobs.all()["grok-f"], undefined);
  assert.equal(fs.existsSync(cloudJobs.file), false);
});
