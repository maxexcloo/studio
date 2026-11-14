import assert from "node:assert/strict";
import test from "node:test";
import { createJobRecovery } from "./job-recovery.js";

/** The recovery's gallery over an array that `read()` returns and `write(items)` replaces. */
function arrayGallery(read, write) {
  const keyOf = (item) => item.url || item.id;
  return {
    tiles: () =>
      read().filter(
        (item) => !item.url && ["pending", "failed", "cancelled"].includes(item.status),
      ),
    job: (id) => read().filter((item) => item.jobId === id),
    save: (items) => {
      const saved = new Map(items.map((item) => [keyOf(item), item]));
      write(read().map((item) => saved.get(keyOf(item)) || item));
    },
    replace: (id, outputs) => {
      const done = new Set(
        read()
          .filter((item) => item.status === "done")
          .map((item) => item.url),
      );
      write([
        ...outputs.filter((item) => !done.has(item.url)),
        ...read().filter((item) => item.jobId !== id || item.url),
      ]);
    },
  };
}

function fixture() {
  const state = {
    backend: "",
    gallery: [],
    jobs: new Map(),
    cancellations: [],
    writes: 0,
    now: 0,
    snapshots: { primary: { queue: {}, history: {} }, video: { queue: {}, history: {} } },
  };
  state.recover = createJobRecovery({
    backends: () => Object.keys(state.snapshots),
    finishJob: (id, patch) =>
      state.jobs.set(id, { ...state.jobs.get(id), ...patch, terminalAt: 1 }),
    gallery: arrayGallery(
      () => state.gallery,
      (items) => {
        state.gallery = items;
        state.writes++;
      },
    ),
    jobs: state.jobs,
    recordsFromHistory: (_backend, history) =>
      Object.values(history).flatMap((entry) => entry.outputs || []),
    request: async (backend, path) => {
      const snapshot = state.snapshots[backend];
      if (snapshot.error) throw new Error("Offline");
      return path === "/queue" ? snapshot.queue : snapshot.history;
    },
    visible: (items) => items.filter((item) => !item.deleted),
    cancel: async (backend, promptId) => state.cancellations.push({ promptId, backend }),
    now: () => state.now,
  });
  return state;
}
const tile = (id, status = "failed") => ({
  id: `${id}-0`,
  jobId: id,
  status,
  url: "",
  type: "video",
});
const queued = (id, promptId = `${id}-prompt`) => [
  0,
  promptId,
  {},
  { studio_generation: { jobId: id } },
];
const result = (id) => ({
  prompt: [0, `${id}-prompt`, {}, { studio_generation: { jobId: id } }],
  outputs: [{ id: `${id}.mp4`, jobId: id, url: `${id}.mp4`, status: "done" }],
  status: { status_str: "success" },
});

test("a stale queue snapshot cannot resurrect a job delivered while another recovery output is saving", async () => {
  const jobs = new Map([
    ["live", { status: "running", comfyBackend: "video", promptId: "live-prompt" }],
  ]);
  let gallery = [tile("recovered", "pending"), tile("live", "pending")];
  let saving;
  const savingStarted = new Promise((resolve) => {
    saving = resolve;
  });
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  const recover = createJobRecovery({
    backends: () => ["video"],
    jobs,
    gallery: arrayGallery(
      () => gallery,
      (items) => {
        gallery = items;
      },
    ),
    finishJob: (id, patch) => jobs.set(id, { ...jobs.get(id), ...patch, terminalAt: 1 }),
    recordsFromHistory: (_backend, history) =>
      Object.values(history).flatMap((entry) => entry.outputs),
    request: async (_backend, path) =>
      path === "/queue"
        ? { queue_running: [queued("live")] }
        : { "recovered-prompt": result("recovered") },
    visible: (items) => items,
    ingest: async (_backend, records) => {
      saving();
      await released;
      return records;
    },
  });
  const recovering = recover();
  await savingStarted;
  const completed = { ...result("live").outputs[0], index: 0 };
  gallery = gallery.map((item) => (item.jobId === "live" ? completed : item));
  jobs.set("live", { ...jobs.get("live"), status: "done", outputs: [completed], terminalAt: 123 });
  release();
  await recovering;
  assert.equal(jobs.get("live").status, "done");
  assert.equal(jobs.get("live").terminalAt, 123);
  assert.equal(jobs.get("live").recovered, undefined);
  assert.deepEqual(
    gallery.find((item) => item.jobId === "live"),
    completed,
  );
  assert.equal(jobs.get("recovered").status, "done");
});

test("restart reattaches failed tiles to running and queued video prompts without submission", async () => {
  const s = fixture();
  s.gallery = [tile("running"), tile("waiting")];
  s.snapshots.video.queue = {
    queue_running: [queued("running")],
    queue_pending: [queued("waiting")],
  };
  await s.recover();
  assert.equal(s.jobs.get("running").status, "running");
  assert.equal(s.jobs.get("waiting").status, "queued");
  assert.equal(s.jobs.get("waiting").comfyBackend, "video");
  assert.equal(s.gallery[0].progress.phase, "Generating");
  assert.equal(s.gallery[1].progress.phase, "Queued");
  assert.ok(s.gallery.every((item) => item.status === "pending"));
  const writes = s.writes;
  await s.recover();
  assert.equal(s.writes, writes, "unchanged polls do not rewrite the gallery");
});

test("restart recovery keeps the account owner attached to its queued job", async () => {
  const s = fixture();
  s.gallery = [{ ...tile("owned"), ownerId: "account-a" }];
  s.snapshots.video.queue = { queue_pending: [queued("owned")] };
  await s.recover();
  assert.equal(s.jobs.get("owned").ownerId, "account-a");
});

test("late completion replaces the false failure and does not duplicate a recovered output", async () => {
  const s = fixture();
  s.gallery = [tile("finished"), ...result("finished").outputs];
  s.snapshots.video.history = { "finished-prompt": result("finished") };
  await s.recover();
  assert.equal(s.gallery.length, 1);
  assert.equal(s.gallery[0].status, "done");
  assert.equal(s.jobs.get("finished").status, "done");
});

test("recovered queued jobs transition to running and then deliver their video", async () => {
  const s = fixture();
  s.gallery = [tile("one")];
  s.snapshots.video.queue = { queue_pending: [queued("one")] };
  await s.recover();
  s.snapshots.video.queue = { queue_running: [queued("one")] };
  await s.recover();
  assert.equal(s.jobs.get("one").status, "running");
  s.snapshots.video.queue = {};
  s.snapshots.video.history = { "one-prompt": result("one") };
  await s.recover();
  assert.equal(s.gallery[0].url, "one.mp4");
  assert.equal(s.jobs.get("one").status, "done");
});

test("offline backends do not mark jobs failed; a missing recovered prompt requires two confirmed misses", async () => {
  const s = fixture();
  s.gallery = [tile("one", "pending")];
  s.jobs.set("one", { recovered: true, status: "running", comfyBackend: "video" });
  s.snapshots.video.error = true;
  await s.recover();
  assert.equal(s.jobs.get("one").status, "running");
  s.snapshots.video.error = false;
  await s.recover();
  assert.equal(s.jobs.get("one").status, "running");
  await s.recover();
  assert.equal(s.jobs.get("one").status, "failed");
});

test("an untracked pending tile fails only after two complete backend scans", async () => {
  const s = fixture();
  s.gallery = [tile("lost", "pending")];
  await s.recover();
  assert.equal(s.gallery[0].status, "pending");
  assert.equal(s.jobs.size, 0);
  await s.recover();
  assert.equal(s.gallery[0].status, "failed");
  assert.equal(s.jobs.get("lost").status, "failed");
});

test("an old error tile becomes terminal only after every backend confirms absence twice", async () => {
  const s = fixture();
  s.gallery = [tile("old-error")];
  s.snapshots.video.error = true;
  await s.recover();
  await s.recover();
  assert.equal(s.jobs.has("old-error"), false);
  s.snapshots.video.error = false;
  await s.recover();
  assert.equal(s.jobs.has("old-error"), false);
  await s.recover();
  assert.equal(s.jobs.get("old-error").status, "failed");
  assert.equal(s.jobs.get("old-error").terminalAt, 1);
});

test("an offline backend resets untracked absence and can later recover the job", async () => {
  const s = fixture();
  s.gallery = [tile("lost", "pending")];
  await s.recover();
  s.snapshots.video.error = true;
  await s.recover();
  await s.recover();
  assert.equal(s.gallery[0].status, "pending");
  s.snapshots.video.error = false;
  await s.recover();
  assert.equal(s.gallery[0].status, "pending");
  s.snapshots.video.queue = { queue_pending: [queued("lost")] };
  await s.recover();
  assert.equal(s.jobs.get("lost").status, "queued");
  assert.equal(s.jobs.get("lost").comfyBackend, "video");
});

test("zero configured backends cannot establish that a pending job is lost", async () => {
  const s = fixture();
  s.gallery = [tile("lost", "pending")];
  delete s.snapshots.video;
  delete s.snapshots.primary;
  await s.recover();
  await s.recover();
  assert.equal(s.gallery[0].status, "pending");
});

test("deleted and cancelled tiles stay absent; live delivery stays with its runner", async () => {
  const s = fixture();
  s.gallery = [
    { ...tile("removed"), deleted: true },
    tile("cancelled", "cancelled"),
    tile("live", "pending"),
  ];
  s.jobs.set("live", { status: "running", comfyBackend: "video" });
  s.snapshots.video.queue = {
    queue_running: [queued("removed"), queued("cancelled"), queued("deleted")],
  };
  s.snapshots.video.history = { "live-prompt": result("live") };
  await s.recover();
  assert.equal(s.jobs.size, 1);
  assert.equal(s.gallery[0].status, "failed");
  assert.equal(s.gallery[1].status, "cancelled");
  assert.equal(s.gallery[2].status, "pending");
});

test("an available backend recovers even when the other backend is offline", async () => {
  const s = fixture();
  s.gallery = [tile("one")];
  s.snapshots.primary.error = true;
  s.snapshots.video.history = { "one-prompt": result("one") };
  await s.recover();
  assert.equal(s.gallery[0].status, "done");
});

test("a completed recovered video racing cancellation retains its saved output", async () => {
  const s = fixture();
  s.gallery = [tile("one", "cancelled")];
  s.jobs.set("one", { recovered: true, status: "cancelling", comfyBackend: "video" });
  s.snapshots.video.history = { "one-prompt": result("one") };
  await s.recover();
  assert.equal(s.jobs.get("one").status, "done");
  assert.equal(s.gallery[0].status, "done");
  assert.equal(s.gallery[0].url, "one.mp4");
});

test("cancel recovery without an acknowledgement waits for its exact recorded job and saves late completion", async () => {
  const s = fixture();
  s.gallery = [tile("own", "pending")];
  s.jobs.set("own", { recovered: true, status: "cancelling", comfyBackend: "video" });
  s.snapshots.video.history = { "foreign-prompt": result("foreign") };
  await s.recover();
  await s.recover();
  assert.equal(s.jobs.get("own").status, "cancelling");
  assert.equal(s.jobs.get("own").terminalAt, undefined);
  assert.equal(s.jobs.has("foreign"), false);
  s.snapshots.video.queue = { queue_running: [queued("own", "late-provider-id")] };
  await s.recover();
  assert.equal(s.jobs.get("own").promptId, "late-provider-id");
  assert.equal(s.jobs.get("own").status, "cancelling");
  assert.deepEqual(s.cancellations, [{ promptId: "late-provider-id", backend: "video" }]);
  s.snapshots.video.queue = {};
  await s.recover();
  assert.equal(
    s.jobs.get("own").terminalAt,
    undefined,
    "one absence cannot discard a racing completion",
  );
  s.snapshots.video.history["late-provider-id"] = result("own");
  await s.recover();
  assert.equal(s.jobs.get("own").status, "done");
  assert.equal(s.gallery[0].url, "own.mp4");
  assert.equal(s.jobs.size, 1);
});

test("a cancellation with no prompt and no tiles settles once its worker has long lacked it", async () => {
  const s = fixture();
  s.jobs.set("lost", { recovered: true, status: "cancelling", comfyBackend: "primary" });
  await s.recover();
  s.now = 2 * 60_000;
  await s.recover();
  assert.equal(s.jobs.get("lost").status, "cancelling", "a lost /prompt may still land");
  s.now = 3 * 60_000;
  await s.recover();
  assert.equal(s.jobs.get("lost").status, "cancelled");
});

test("an untracked job reported lost can still accept a late backend result", async () => {
  const s = fixture();
  s.gallery = [tile("late", "pending")];
  await s.recover();
  await s.recover();
  assert.equal(s.gallery[0].status, "failed");
  s.snapshots.video.history = { "late-prompt": result("late") };
  await s.recover();
  assert.equal(s.gallery[0].url, "late.mp4");
  assert.equal(s.jobs.get("late").status, "done");
});

test("a running job its runner follows costs the worker nothing: no queue or history scans", async () => {
  const s = fixture();
  const asked = [];
  s.gallery = [{ ...tile("long", "pending"), progress: { value: 3, max: 20 } }];
  s.jobs.set("long", {
    status: "running",
    comfyBackend: "video",
    promptId: "long-prompt",
    progress: { value: 3, max: 20 },
  });
  s.snapshots.video.queue = { queue_running: [queued("long")] };
  // Count what recovery asks ComfyUI for over a long run's many ticks.
  const recover = createJobRecovery({
    backends: () => ["video"],
    finishJob: () => assert.fail("a live job is not finished by recovery"),
    gallery: arrayGallery(
      () => s.gallery,
      () => assert.fail("a live job's tiles are the runner's to write"),
    ),
    jobs: s.jobs,
    recordsFromHistory: () => [],
    request: async (_backend, path) => {
      asked.push(path);
      return {};
    },
    visible: (items) => items,
  });
  for (let tick = 0; tick < 5; tick++) await recover();
  assert.deepEqual(asked, []);
  assert.equal(s.jobs.get("long").progress.value, 3);
});

test("a restored long video keeps its index, request time, settings, Dream mark and elapsed time from ComfyUI history", async () => {
  const s = fixture();
  const createdAt = "2026-10-22T10:00:00.000Z";
  const start = Date.parse(createdAt) + 5_000;
  const end = start + 19 * 60_000;
  s.gallery = [
    {
      ...tile("fl20", "pending"),
      index: 0,
      createdAt,
      ownerId: "account-a",
      settings: { profileId: "h3-fl-stock20", frames: 192 },
      dream: { state: "unseen", prompt: "", why: "", at: createdAt },
    },
  ];
  s.jobs.set("fl20", {
    recovered: true,
    status: "running",
    comfyBackend: "video",
    promptId: "fl20-prompt",
  });
  // As recordsFromComfyHistory builds them: no index, no times, the graph's guess at settings.
  const history = {
    prompt: [0, "fl20-prompt", {}, { studio_generation: { jobId: "fl20" } }],
    outputs: [
      {
        id: "fl20.mp4",
        jobId: "fl20",
        url: "/comfy/view?filename=fl20.mp4",
        type: "video",
        status: "done",
        createdAt: new Date(start - 60_000).toISOString(),
        settings: {},
      },
    ],
    status: {
      status_str: "success",
      messages: [
        ["execution_start", { prompt_id: "fl20-prompt", timestamp: start }],
        ["execution_cached", { nodes: [] }],
        ["execution_success", { prompt_id: "fl20-prompt", timestamp: end }],
      ],
    },
  };
  s.snapshots.video.history = { "fl20-prompt": history };
  await s.recover();
  const [record] = s.gallery;
  assert.equal(record.url, "/comfy/view?filename=fl20.mp4");
  assert.equal(record.index, 0, "MCP results and signed links find outputs by index");
  assert.equal(record.createdAt, createdAt);
  assert.equal(record.ownerId, "account-a");
  assert.deepEqual(record.settings, { profileId: "h3-fl-stock20", frames: 192 });
  assert.equal(record.dream.state, "unseen", "a Dream result stays in Dream's pool");
  assert.equal(record.durationMs, end - Date.parse(createdAt));
  assert.deepEqual(record.timing, { runMs: 19 * 60_000, queueMs: 5_000 });
  assert.equal(record.promptId, "fl20-prompt");
  assert.equal(s.jobs.get("fl20").status, "done");
  assert.equal(s.jobs.get("fl20").outputs[0].index, 0);
});

test("a run its runner gave up on (busy worker) is followed again and delivered from history at once", async () => {
  const s = fixture();
  s.gallery = [{ ...tile("busy", "failed"), index: 0 }];
  s.jobs.set("busy", {
    status: "failed",
    error: "ComfyUI stopped answering for over a minute, so this run was given up.",
    terminalAt: 1,
    comfyBackend: "video",
    promptId: "busy-prompt",
  });
  s.snapshots.video.queue = { queue_running: [queued("busy")] };
  await s.recover();
  assert.equal(s.jobs.get("busy").status, "running");
  assert.equal(s.jobs.get("busy").recovered, true);
  assert.equal(
    s.jobs.get("busy").terminalAt,
    undefined,
    "its earlier end no longer expires the live job",
  );
  assert.equal(s.gallery[0].status, "pending");
  s.snapshots.video.queue = {};
  s.snapshots.video.history = { "busy-prompt": result("busy") };
  await s.recover();
  assert.equal(s.jobs.get("busy").status, "done");
  assert.equal(s.gallery[0].url, "busy.mp4");
});

test("a failure its runner recorded keeps its reason when ComfyUI has no output either", async () => {
  const s = fixture();
  s.gallery = [{ ...tile("failed", "failed"), failure: { summary: "Out of memory" } }];
  s.jobs.set("failed", {
    status: "failed",
    error: "Out of memory",
    terminalAt: 1,
    comfyBackend: "video",
  });
  s.snapshots.video.history = {
    "failed-prompt": {
      prompt: [0, "failed-prompt", {}, { studio_generation: { jobId: "failed" } }],
      outputs: [],
      status: { status_str: "error" },
    },
  };
  await s.recover();
  assert.equal(s.jobs.get("failed").error, "Out of memory");
  assert.deepEqual(s.gallery[0].failure, { summary: "Out of memory" });
});

test("recovered jobs with known prompts are looked up one by one, not through the whole history", async () => {
  const asked = [];
  const jobs = new Map([
    ["one", { recovered: true, status: "running", comfyBackend: "video", promptId: "one-prompt" }],
  ]);
  let gallery = [tile("one", "pending")];
  const recover = createJobRecovery({
    backends: () => ["video"],
    finishJob: (id, patch) => jobs.set(id, { ...jobs.get(id), ...patch }),
    gallery: arrayGallery(
      () => gallery,
      (items) => {
        gallery = items;
      },
    ),
    jobs,
    recordsFromHistory: (_backend, history) =>
      Object.values(history).flatMap((entry) => entry.outputs || []),
    request: async (_backend, path) => {
      asked.push(path);
      return path === "/queue"
        ? {}
        : path === "/history/one-prompt"
          ? { "one-prompt": result("one") }
          : assert.fail(`unexpected ${path}`);
    },
    visible: (items) => items,
  });
  await recover();
  assert.deepEqual(asked.sort(), ["/history/one-prompt", "/queue"]);
  assert.equal(jobs.get("one").status, "done");
});
