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
import { writeTestWorkflows } from "./fixtures/test-workflows.js";
import { fakeKubernetes } from "./fixtures/fake-kubernetes.ts";

async function cancellationFixture(t, lostAcknowledgement = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-generation-cancel-"));
  writeTestWorkflows(path.join(directory, "runtime"));
  const info = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/object_info-comfyui-0.41.0-master-ce1e922.json", import.meta.url),
      "utf8",
    ),
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
  // Media and text share the one GPU; media starts running.
  const gpu = { pool: "gpu", gpus: 1 };
  const kube = fakeKubernetes(
    [
      {
        namespace: "gpu",
        name: "media",
        replicas: 1,
        workload: { ...gpu, kind: "image", url: worker.url },
      },
      { namespace: "gpu", name: "text" },
    ],
    { tickOnRead: true },
  );
  const operations = kube.log;
  const engine = http.createServer(kube.handle);
  engine.listen(0, "127.0.0.1");
  await once(engine, "listening");
  const text = http.createServer((request, response) => {
    if (request.url === "/health") return response.end("{}");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: "Fixture text" } }] }));
  });
  text.listen(0, "127.0.0.1");
  await once(text, "listening");
  kube.deployments.get("gpu/text").workload = {
    ...gpu,
    kind: "text",
    url: `http://127.0.0.1:${text.address().port}`,
  };
  const launch = () =>
    fork(fileURLToPath(new URL("./index.js", import.meta.url)), [], {
      env: {
        PATH: process.env.PATH,
        PORT: "0",
        HOST: "127.0.0.1",
        STUDIO_ENV_FILE: "/dev/null",
        STUDIO_DATA_DIR: path.join(directory, "runtime"),
        STUDIO_WORKERS: JSON.stringify([
          { id: "chosen", name: "Chosen", url: worker.url, capabilities: ["image"] },
        ]),
        STUDIO_KUBERNETES_GPUS: JSON.stringify({ gpu: 1 }),
        STUDIO_KUBERNETES_URL: `http://127.0.0.1:${engine.address().port}`,
        STUDIO_KUBERNETES_NAMESPACES: "gpu",
        STUDIO_LOCAL_TEXT_MODEL: "local/auto",
        STUDIO_RUNTIME_AUTOMATIC: "1",
        STUDIO_TEXT_KEY: "fixture-text",
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
    (profile) => profile.id === "custom:test-image",
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
  worker.setDown(false);
  // The worker accepts an interrupt request but deliberately leaves this prompt running.
  await waitFor(
    async () => worker.requests.filter((request) => request.pathname === "/interrupt"),
    (requests) => requests.length > 0,
  );
  const active = (await api("/api/queue")).body.jobs.find((job) => job.id === accepted.body.jobId);
  assert.equal(recordedJob(active.id).cancelRequested, true);
  assert.equal(active.status, "running");
  // An administrator switches the GPU to text; the change waits for the cancelled job.
  const preview = await api("/api/runtime/preview", { workloads: ["text"] });
  assert.equal(preview.status, 200);
  const apply = await api("/api/runtime/apply", {
    workloads: ["text"],
    signature: preview.body.signature,
  });
  assert.equal(apply.status, 202);
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
  // The switch waited for the saved output; now it stops media, waits for its pod and starts text.
  await waitFor(
    async () => operations,
    (list) => list.includes("scale gpu/text 1"),
  );
  assert.deepEqual(operations, ["scale gpu/media 0", "gone gpu/media", "scale gpu/text 1"]);
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
