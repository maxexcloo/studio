import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { startFakeComfy } from "./fixtures/fake-comfy.js";

async function cancellationFixture(t, lostAcknowledgement = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-generation-cancel-"));
  const config = path.join(directory, "config");
  fs.mkdirSync(config);
  const info = JSON.parse(
    fs.readFileSync(new URL("./fixtures/object_info-comfyui-0.34.1.json", import.meta.url), "utf8"),
  );
  info.CheckpointLoaderSimple.input.required.ckpt_name[0] = ["sd_xl_base_1.0.safetensors"];
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "white" } })
    .png()
    .toBuffer();
  let dropAcknowledgement;
  let acceptedByWorker;
  const pendingAcknowledgement = new Promise((resolve) => {
    dropAcknowledgement = resolve;
  });
  const providerAccepted = new Promise((resolve) => {
    acceptedByWorker = resolve;
  });
  const worker = await startFakeComfy({
    objectInfo: info,
    ...(lostAcknowledgement
      ? {
          acknowledgePrompt: async (prompt) => {
            acceptedByWorker(prompt);
            await pendingAcknowledgement;
            return false;
          },
        }
      : {}),
    outputFiles: new Map([["own.png", png]]),
  });
  const running = new Set(["media"]);
  const operations = [];
  const engine = http.createServer((request, response) => {
    const match = /^\/containers\/(media|text)\/(json|start|stop)/.exec(request.url);
    if (!match) return response.writeHead(404).end();
    const [, id, action] = match;
    if (action === "json")
      return response.end(JSON.stringify({ State: { Running: running.has(id) } }));
    operations.push(`${action}:${id}`);
    if (action === "start") running.add(id);
    else running.delete(id);
    response.writeHead(204).end();
  });
  engine.listen(0, "127.0.0.1");
  await once(engine, "listening");
  const text = http.createServer((request, response) => {
    if (request.url === "/health") return response.end("{}");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: "Fixture text" } }] }));
  });
  text.listen(0, "127.0.0.1");
  await once(text, "listening");
  fs.writeFileSync(
    path.join(config, "workloads.json"),
    JSON.stringify({
      media: {
        kind: "image",
        placements: ["0"],
        studio: { container: "media", placement: "0", url: worker.url },
      },
      text: {
        kind: "text",
        placements: ["0"],
        studio: {
          container: "text",
          placement: "0",
          url: `http://127.0.0.1:${text.address().port}`,
          apiKeyEnv: "STUDIO_FIXTURE_TEXT_KEY",
        },
      },
    }),
  );
  const launch = () =>
    fork(fileURLToPath(new URL("./index.js", import.meta.url)), [], {
      env: {
        PATH: process.env.PATH,
        PORT: "0",
        HOST: "127.0.0.1",
        STUDIO_ENV_FILE: "/dev/null",
        STUDIO_DATA_DIR: path.join(directory, "runtime"),
        STUDIO_CONFIG_DIR: config,
        STUDIO_ENABLE_BUILTIN_PROFILES: "1",
        STUDIO_WORKERS: JSON.stringify([
          { id: "chosen", name: "Chosen", url: worker.url, capabilities: ["image"] },
        ]),
        STUDIO_DOCKER_URL: `http://127.0.0.1:${engine.address().port}`,
        STUDIO_RUNTIME_AUTOMATIC: "1",
        STUDIO_RUNTIME_OWNERSHIP_ACKNOWLEDGED: "1",
        STUDIO_TEXT_ADMISSION_ACKNOWLEDGED: "1",
        STUDIO_TEXT_WORKLOAD: "text",
        STUDIO_TEXT_ADMISSION_TOKEN: "fixture-admission",
        STUDIO_FIXTURE_TEXT_KEY: "fixture-text",
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
  let child = launch();
  t.after(async () => {
    worker.setDown(false);
    const stopped = child.exitCode === null ? once(child, "exit") : undefined;
    child.kill("SIGTERM");
    await stopped;
    await worker.close();
    for (const server of [engine, text]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const [ready] = await Promise.race([
    once(child, "message"),
    once(child, "exit").then(() => {
      throw new Error("Cancellation fixture exited before readiness");
    }),
  ]);
  let base = ready.url.replace("localhost", "127.0.0.1");
  const recordedJob = (id) => {
    const db = new DatabaseSync(path.join(directory, "runtime", "studio.sqlite"), {
      readOnly: true,
    });
    try {
      return JSON.parse(db.prepare("SELECT record FROM studio_queue WHERE id = ?").get(id).record);
    } finally {
      db.close();
    }
  };
  const api = async (route, body, headers = {}) => {
    const response = await fetch(base + route, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : (await response.arrayBuffer(), {});
    return { status: response.status, body: payload };
  };
  const waitFor = async (read, condition) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const value = await read();
      if (condition(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error("Cancellation fixture did not reach the observed provider state");
  };
  const profile = (await api("/api/models")).body.profiles.find(
    (profile) => profile.model === "sd_xl_base_1.0.safetensors",
  );
  assert.ok(profile);
  const submitted = worker.nextPrompt();
  const accepted = await api("/api/generate", {
    ...profile.defaults,
    kind: "image",
    profileId: profile.id,
    workflow: profile.workflow,
    model: profile.model,
    prompt: "Neutral white teapot",
    width: 64,
    height: 64,
    steps: 2,
    backendId: "chosen",
  });
  assert.equal(accepted.status, 200);
  const prompt = await (lostAcknowledgement ? providerAccepted : submitted);
  if (lostAcknowledgement) {
    assert.equal((await api(`/api/queue/${accepted.body.jobId}/cancel`, {})).status, 200);
    worker.setDown(true);
    dropAcknowledgement();
    await waitFor(
      async () => (await api(`/api/jobs/${accepted.body.jobId}`)).body,
      (job) => /Checking the recorded generation/.test(job.error || job.reason || ""),
    );
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
    worker.setDown(true);
    child = launch();
    const [restarted] = await once(child, "message");
    base = restarted.url.replace("localhost", "127.0.0.1");
  }
  worker.setDown(true);
  if (!lostAcknowledgement)
    assert.equal((await api(`/api/queue/${accepted.body.jobId}/cancel`, {})).status, 503);
  const textRequest = () =>
    api(
      "/api/local-text/v1/chat/completions",
      { model: "local", messages: [{ role: "user", content: "Fixture" }] },
      { Authorization: "Bearer fixture-admission" },
    );
  assert.equal((await textRequest()).status, 503);
  worker.setDown(false);
  // The worker accepts an interrupt request but deliberately leaves this prompt running.
  await waitFor(
    async () => worker.requests.filter((request) => request.pathname === "/interrupt"),
    (requests) => requests.length > 0,
  );
  const active = (await api("/api/queue")).body.jobs.find((job) => job.id === accepted.body.jobId);
  assert.equal(recordedJob(active.id).cancelRequested, true);
  assert.equal(active.status, "running");
  assert.equal((await textRequest()).status, 503);
  assert.deepEqual(operations, []);
  const save = Object.entries(prompt.prompt).find(([, node]) => node.class_type === "SaveImage")[0];
  worker.finish(prompt.id, {
    outputs: { [save]: { images: [{ filename: "own.png", type: "output", subfolder: "" }] } },
  });
  worker.send(accepted.body.jobId, { type: "execution_success", data: { prompt_id: prompt.id } });
  const completed = await waitFor(
    async () => (await api("/api/queue")).body.jobs.find((job) => job.id === accepted.body.jobId),
    (job) => job.status === "completed",
  );
  assert.equal(recordedJob(completed.id).cancelRequested, true);
  assert.equal(completed.outputs.length, 1);
  assert.equal(new URL(completed.outputs[0].url, base).searchParams.get("type"), "media");
  const saved = await fetch(new URL(completed.outputs[0].url, base));
  assert.equal(saved.status, 200);
  assert.ok((await saved.arrayBuffer()).byteLength > 0);
  assert.equal((await textRequest()).status, 200);
  assert.deepEqual(operations, ["stop:media", "start:text"]);
  assert.equal(worker.prompts.length, 1);
}

for (const lost of [false, true])
  test(
    lost
      ? "lost generation acknowledgement and cancellation recover after restart without resubmission"
      : "cancelled generation holds GPU admission until provider stops and outputs save",
    { timeout: 30_000 },
    (t) => cancellationFixture(t, lost),
  );
