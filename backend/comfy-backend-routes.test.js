import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer, request as forward } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startFakeComfy } from "./fixtures/fake-comfy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(
  fs.readFileSync(path.join(here, "fixtures/object_info-comfyui-0.34.1.json"), "utf8"),
);
const imageInfo = structuredClone(source);
imageInfo.CheckpointLoaderSimple.input.required.ckpt_name[0] = ["sd_xl_base_1.0.safetensors"];
imageInfo.UNETLoader.input.required.unet_name[0] = ["tessera-v0.3.1-turbo-opd-W8A8.safetensors"];
imageInfo.LoraLoader.input.required.lora_name[0] = ["private-lora.safetensors"];
const videoInfo = structuredClone(source);
videoInfo.CheckpointLoaderSimple.input.required.ckpt_name[0] = [];
videoInfo.UNETLoader.input.required.unet_name[0] = [
  "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
];
videoInfo.CLIPLoader.input.required.clip_name[0] = ["qwen3vl_32b_h3.safetensors"];
videoInfo.VAELoader.input.required.vae_name[0] = [
  "minimax_h3_video_vae.safetensors",
  "minimax_h3_audio_vae.safetensors",
];
const primary = await startFakeComfy({ objectInfo: imageInfo });
const video = await startFakeComfy({ objectInfo: videoInfo });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-backend-routes-"));
fs.mkdirSync(path.join(dataDir, "workflows"));
fs.writeFileSync(
  path.join(dataDir, "lora-catalogue.json"),
  JSON.stringify({ "private-lora.safetensors": { triggers: ["privfx"] } }),
);
let server;
let base;

async function start(useVideo = true, restrictModels = false, runtimeDir = dataDir) {
  server = fork(path.join(here, "index.js"), [], {
    cwd: path.join(here, ".."),
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      STUDIO_WORKERS: JSON.stringify([
        {
          id: "primary",
          name: "Image Worker",
          url: primary.url,
          capabilities: useVideo
            ? ["image", "upscale", "models"]
            : ["image", "video", "upscale", "models"],
        },
        ...(useVideo
          ? [{ id: "video", name: "Video Worker", url: video.url, capabilities: ["video"] }]
          : []),
      ]),
      STUDIO_ENABLE_TESSERA: restrictModels ? "0" : "1",
      STUDIO_ENABLE_LORAS: restrictModels ? "0" : "1",
      STUDIO_DATA_DIR: runtimeDir,
      STUDIO_COMFY_OUTPUT_DIR: "",
      npm_lifecycle_event: "",
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let errors = "";
  server.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const message = await new Promise((resolve, reject) => {
    server.once("message", resolve);
    server.once("exit", (code) => reject(new Error(`Server exited ${code}: ${errors}`)));
  });
  base = message.url.replace("localhost", "127.0.0.1");
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
}
// A worker that stopped answering is remembered for a while; a restarted Studio asks again.
async function restart() {
  await stop();
  await start();
}
async function api(route, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json", "X-Studio": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const generation = (profile) => ({
  ...profile.defaults,
  kind: profile.kind,
  profileId: profile.id,
  workflow: profile.workflow,
  model: profile.model,
  prompt: "a red ceramic teapot",
  count: 1,
});

test.before(() => start());
test.after(async () => {
  await stop();
  await primary.close();
  await video.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("the catalogue reports whether the local video worker answered", async () => {
  try {
    let models = (await api("/api/models")).body;
    assert.deepEqual(models.backends.video, { configured: true, available: true });
    video.setDown(true);
    models = (await api("/api/models")).body;
    assert.deepEqual(models.backends.video, { configured: true, available: false });
    const offline = models.profiles.find((profile) => profile.family === "minimax_h3");
    assert.equal(offline.availability, "offline");
    assert.equal(offline.ready, undefined);
  } finally {
    video.setDown(false);
    await restart();
  }
});

test(
  "catalogue reads cache an offline worker while accepted work waits on its selected backend",
  { timeout: 10000 },
  async () => {
    const h3 = (await api("/api/models")).body.profiles.find(
      (profile) => profile.family === "minimax_h3",
    );
    const probes = () => video.requests.filter((entry) => entry.pathname === "/object_info").length;
    try {
      video.setDown(true);
      assert.deepEqual((await api("/api/models")).body.backends.video, {
        configured: true,
        available: false,
      });
      const before = probes();
      assert.deepEqual((await api("/api/models")).body.backends.video, {
        configured: true,
        available: false,
      });
      assert.deepEqual((await api("/api/models?cached=1")).body.backends.video, {
        configured: true,
        available: false,
      });
      assert.equal(probes(), before);
      const accepted = await api("/api/generate", generation(h3));
      assert.equal(accepted.status, 200);
      const recorded = (await api("/api/queue")).body.jobs.find(
        (job) => job.id === accepted.body.jobId,
      );
      assert.equal(recorded.backend, "video");
      assert.ok(["queued", "waiting"].includes(recorded.status));
      await api(`/api/jobs/${recorded.id}/cancel`, {});
      assert.equal(
        (await api("/api/queue")).body.jobs.find((job) => job.id === recorded.id).status,
        "cancelled",
      );
      video.setDown(false);
      // Still remembered until Studio asks the worker again.
      assert.deepEqual((await api("/api/models")).body.backends.video, {
        configured: true,
        available: false,
      });
      await restart();
      const models = (await api("/api/models")).body;
      assert.deepEqual(models.backends.video, { configured: true, available: true });
      assert.ok(models.profiles.some((profile) => profile.family === "minimax_h3"));
      assert.ok(probes() > before);
    } finally {
      video.setDown(false);
    }
  },
);

test(
  "generate leads with enabled LoRAs’ trigger words unless their toggle is off, and the run keeps that prompt",
  { timeout: 10000 },
  async () => {
    const sdxl = (await api("/api/models")).body.profiles.find(
      (profile) => profile.capabilities?.lora && profile.kind === "image" && profile.ready,
    );
    assert.ok(sdxl);
    const run = async (lora) => {
      const queued = primary.nextPrompt();
      const accepted = await api("/api/generate", {
        ...generation(sdxl),
        loras: [{ name: "private-lora.safetensors", strength: 0.7, ...lora }],
      });
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      const sent = await queued;
      await api(`/api/jobs/${accepted.body.jobId}/cancel`, {});
      primary.drop(sent.id);
      const texts = Object.values(sent.prompt)
        .filter((node) => node.class_type === "CLIPTextEncode")
        .map((node) => node.inputs.text);
      const item = (await api("/api/gallery?limit=200")).body.items.find(
        (entry) => entry.jobId === accepted.body.jobId,
      );
      return { texts, prompt: item.prompt };
    };
    const on = await run({});
    assert.equal(on.prompt, "privfx, a red ceramic teapot");
    assert.ok(on.texts.includes("privfx, a red ceramic teapot"));
    assert.equal((await run({ triggers: false })).prompt, "a red ceramic teapot");
    assert.equal((await run({ enabled: false })).prompt, "a red ceramic teapot");
  },
);

test(
  "HTTP catalogue and generate select the video node schema and cancel only target",
  { timeout: 10000 },
  async () => {
    const models = (await api("/api/models")).body;
    const h3 = models.profiles.find((profile) => profile.family === "minimax_h3");
    assert.ok(h3?.ready, JSON.stringify(h3));
    const videoQueued = video.nextPrompt();
    const accepted = await api("/api/generate", generation(h3));
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const h3Prompt = await videoQueued;
    assert.equal(h3Prompt.client_id, accepted.body.jobId);
    assert.ok(
      Object.values(h3Prompt.prompt).some((node) => node.class_type === "MiniMaxH3ImageToVideo"),
    );
    const before = primary.requests.length;
    await api(`/api/jobs/${accepted.body.jobId}/cancel`, {});
    assert.equal(
      primary.requests.slice(before).some((entry) => entry.pathname === "/interrupt"),
      false,
    );
    assert.ok(video.requests.some((entry) => entry.pathname === "/interrupt"));
    video.drop(h3Prompt.id);
  },
);

test(
  "completed secondary work recovers after a Studio restart with prompt and backend provenance",
  { timeout: 10000 },
  async () => {
    const h3 = (await api("/api/models")).body.profiles.find(
      (profile) => profile.family === "minimax_h3",
    );
    const queued = video.nextPrompt();
    const accepted = await api("/api/generate", generation(h3));
    assert.equal(accepted.status, 200);
    const prompt = await queued;
    await stop();
    video.finish(prompt.id, {
      outputs: { saved: { videos: [{ filename: "after-restart.mp4", type: "output" }] } },
    });
    await start();
    // Studio recovers ComfyUI's history on its own shortly after it starts.
    let result;
    for (let tries = 0; !result && tries < 80; tries += 1) {
      if (tries) await new Promise((resolve) => setTimeout(resolve, 100));
      result = (await api("/api/gallery?limit=200")).body.items.find(
        (item) => item.jobId === accepted.body.jobId && item.status === "done",
      );
    }
    assert.ok(result);
    assert.equal(result.prompt, "a red ceramic teapot");
    assert.equal(result.settings.comfyBackend, "video");
    assert.equal(result.type, "video");
  },
);

test(
  "offline secondary retains H3 and queues only its selected backend",
  { timeout: 10000 },
  async () => {
    const h3 = (await api("/api/models")).body.profiles.find(
      (profile) => profile.family === "minimax_h3",
    );
    video.setDown(true);
    const count = primary.prompts.length;
    const catalogue = (await api("/api/models")).body;
    const offline = catalogue.profiles.find((profile) => profile.family === "minimax_h3");
    assert.equal(offline.availability, "offline");
    assert.equal(offline.ready, undefined);
    const response = await api("/api/generate", generation(h3));
    assert.equal(response.status, 200);
    const queued = (await api("/api/queue")).body.jobs.find(
      (job) => job.id === response.body.jobId,
    );
    assert.equal(queued.backend, "video");
    await api(`/api/jobs/${queued.id}/cancel`, {});
    assert.equal(primary.prompts.length, count);
    video.setDown(false);
  },
);

test(
  "an instance without video configuration cannot be redirected by request fields",
  { timeout: 10000 },
  async () => {
    await stop();
    await start(false);
    const profiles = (await api("/api/models")).body.profiles;
    assert.equal(
      profiles.some((profile) => profile.family === "minimax_h3"),
      false,
    );
    const image = profiles.find((profile) => profile.kind === "image" && profile.ready);
    const secondaryCount = video.prompts.length;
    const queued = primary.nextPrompt();
    const accepted = await api("/api/generate", {
      ...generation(image),
      comfyBackend: "video",
    });
    assert.equal(accepted.status, 200);
    const prompt = await queued;
    assert.equal(video.prompts.length, secondaryCount);
    await api(`/api/jobs/${accepted.body.jobId}/cancel`, {});
    primary.drop(prompt.id);
  },
);

test(
  "SFW instances hide restricted models and LoRAs on either backend configuration",
  { timeout: 10000 },
  async () => {
    const before = (await api("/api/models")).body;
    assert.ok(before.modelFiles.some((file) => file.name.startsWith("tessera-")));
    assert.ok(before.loras.includes("private-lora.safetensors"));
    try {
      for (const useVideo of [true, false]) {
        await stop();
        await start(useVideo, true);
        const models = (await api("/api/models")).body;
        assert.equal(
          models.profiles.some((profile) => profile.model.startsWith("tessera-")),
          false,
        );
        assert.equal(
          models.modelFiles.some((file) => file.name.startsWith("tessera-")),
          false,
        );
        assert.deepEqual(models.loras, []);
        assert.ok(models.profiles.every((profile) => !profile.capabilities.lora));
        assert.deepEqual((await api("/api/loras/info")).body.loras, {});
        assert.equal((await api("/api/loras/library")).body.found, false);
        assert.deepEqual((await api("/api/loras/saved-profile")).body.loras, []);
      }
    } finally {
      await stop();
      await start();
    }
  },
);

test(
  "repeating an acknowledged client job ID does not queue another video",
  { timeout: 10000 },
  async () => {
    const profile = (await api("/api/models")).body.profiles.find(
      (item) => item.family === "minimax_h3",
    );
    const body = { ...generation(profile), clientJobId: "animation-retry-once" };
    const promptCount = video.requests.filter((request) => request.pathname === "/prompt").length;
    const next = video.nextPrompt();
    const [first, concurrent] = await Promise.all([
      api("/api/generate", body),
      api("/api/generate", body),
    ]);
    assert.equal(first.status, 200);
    assert.equal(concurrent.status, 200);
    assert.equal(concurrent.body.jobId, first.body.jobId);
    const queued = await next;
    const before = video.requests.filter((request) => request.pathname === "/prompt").length;
    assert.equal(before, promptCount + 1);
    const repeat = await api("/api/generate", body);
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.jobId, first.body.jobId);
    assert.equal(video.requests.filter((request) => request.pathname === "/prompt").length, before);
    await api(`/api/jobs/${first.body.jobId}/cancel`, {});
    video.drop(queued.id);
  },
);

test("cached catalogue reads reflect profile creation, editing, approval and deletion without worker rescans", async () => {
  await api("/api/models");
  const before = primary.requests.filter((item) => item.pathname === "/object_info").length;
  const workflow = {
    studio: {
      id: "cache-readback",
      name: "Cached First",
      kind: "image",
      family: "tessera",
      controls: { prompt: { node: "2", input: "text" } },
    },
    graph: {
      1: {
        class_type: "UNETLoader",
        inputs: { unet_name: "tessera-v0.3.1-turbo-opd-W8A8.safetensors" },
      },
      2: { class_type: "CLIPTextEncode", inputs: { text: "" } },
    },
  };
  const created = await api("/api/workflows/import", { workflow });
  assert.equal(created.status, 200);
  const selected = async () =>
    (await api("/api/models?cached=1")).body.profiles.find(
      (item) => item.id === "custom:cache-readback",
    );
  assert.equal((await selected()).label, "Cached First");
  const current = (await api("/api/profiles/editable/cache-readback")).body;
  const raw = JSON.parse(current.text);
  raw.studio.name = "Cached Edited";
  assert.equal(
    (
      await api(
        "/api/profiles/editable/cache-readback",
        { text: JSON.stringify(raw), baseHash: current.hash },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal((await selected()).label, "Cached Edited");
  const approved = await api("/api/profiles/editable/cache-readback/approve", {});
  assert.equal(approved.status, 200);
  assert.equal(approved.body.meta.aiDrafted, false);
  assert.equal((await selected()).label, "Cached Edited");
  assert.equal((await api("/api/workflows/cache-readback", undefined, "DELETE")).status, 200);
  assert.equal(await selected(), undefined);
  assert.equal(primary.requests.filter((item) => item.pathname === "/object_info").length, before);
});

test(
  "hung worker schema and metadata reads abort while retained profiles and pinned queued work remain available",
  { timeout: 40_000 },
  async () => {
    const actual = video.url;
    const isolatedData = fs.mkdtempSync(path.join(os.tmpdir(), "studio-held-catalogue-"));
    let holdSchema = false,
      holdMetadata = false,
      schemaRequests = 0,
      schemaAborted = 0,
      metadataRequests = 0;
    const closed = [];
    const proxy = createServer((request, response) => {
      const url = new URL(request.url, actual);
      const held =
        (holdSchema && url.pathname === "/object_info") ||
        (holdMetadata && url.pathname.startsWith("/view_metadata/"));
      if (held) {
        if (url.pathname === "/object_info") schemaRequests++;
        else metadataRequests++;
        response.on("close", () => {
          if (url.pathname === "/object_info") schemaAborted++;
          for (const wake of closed.splice(0)) wake();
        });
        return;
      }
      const upstream = forward(
        url,
        { method: request.method, headers: request.headers },
        (source) => {
          response.writeHead(source.statusCode, source.headers);
          source.pipe(response);
        },
      );
      upstream.on("error", () => response.destroy());
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    await stop();
    video.url = `http://127.0.0.1:${proxy.address().port}`;
    let jobId;
    try {
      await start(true, false, isolatedData);
      const original = (await api("/api/models")).body;
      const h3 = original.profiles.find((item) => item.family === "minimax_h3");
      assert.ok(h3);
      holdSchema = true;
      const catalogues = await Promise.all([
        api("/api/models"),
        api("/api/models"),
        api("/api/models"),
      ]);
      assert.equal(schemaRequests, 1, "concurrent explicit refreshes share one worker request");
      if (!schemaAborted) await new Promise((resolve) => closed.push(resolve));
      assert.equal(schemaAborted, 1, "the worker connection is aborted, not left behind");
      for (const { body } of catalogues) {
        assert.ok(body.profiles.some((item) => item.kind === "image"));
        const retained = body.profiles.find((item) => item.id === h3.id);
        assert.equal(retained.availability, "offline");
        assert.equal(retained.ready, undefined);
        assert.equal(body.workers.find((item) => item.id === "primary").available, true);
        assert.equal(body.workers.find((item) => item.id === "video").available, false);
      }
      const submitted = primary.prompts.length;
      const accepted = await api("/api/generate", {
        ...generation(h3),
        backendId: "video",
        allowFallback: false,
      });
      assert.equal(accepted.status, 200);
      jobId = accepted.body.jobId;
      let waiting;
      for (let attempt = 0; attempt < 250; attempt++) {
        waiting = (await api("/api/queue")).body.jobs.find((job) => job.id === jobId);
        if (waiting.status === "waiting") break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(waiting.status, "waiting");
      assert.equal(schemaRequests, 1, "admission and eligibility reuse the failed read");
      assert.equal(waiting.backend, "video");
      assert.equal(waiting.input.profileId, h3.id);
      assert.equal(primary.prompts.length, submitted);
      await api(`/api/jobs/${jobId}/cancel`, {});
      jobId = undefined;
      holdSchema = false;
      await api("/api/models");
      videoInfo.UNETLoader.input.required.unet_name[0].push("new-metadata-fixture.safetensors");
      holdMetadata = true;
      const refreshed = await Promise.all([api("/api/models"), api("/api/models")]);
      assert.equal(metadataRequests, 1, "metadata priming shares the context deadline and refresh");
      for (const { body } of refreshed) assert.ok(body.profiles.some((item) => item.id === h3.id));
    } finally {
      if (jobId) await api(`/api/jobs/${jobId}/cancel`, {});
      await stop();
      holdSchema = false;
      holdMetadata = false;
      videoInfo.UNETLoader.input.required.unet_name[0] =
        videoInfo.UNETLoader.input.required.unet_name[0].filter(
          (name) => name !== "new-metadata-fixture.safetensors",
        );
      video.url = actual;
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
      fs.rmSync(isolatedData, { recursive: true, force: true });
      await start();
    }
  },
);
