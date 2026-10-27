import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import express from "express";
import { fakeKubernetes } from "../fixtures/fake-kubernetes.ts";
import { RuntimeController, type Workload } from "./controller.ts";
import { KubernetesEngine } from "./kubernetes.ts";
import { createRuntimeRouter, createTextAdmissionRouter } from "./routes.ts";

/** One GPU, shared by every workload given; `running` start with a ready pod. */
function runtime(workloads: Pick<Workload, "id" | "kind" | "url">[], running: string[]) {
  const kube = fakeKubernetes(
    workloads.map(({ id }) => ({
      namespace: "gpu",
      name: id,
      replicas: running.includes(id) ? 1 : 0,
    })),
  );
  const controller = new RuntimeController({
    engine: new KubernetesEngine(kube.request),
    workloads: workloads.map((item) => ({
      ...item,
      label: item.id,
      namespace: "gpu",
      deployment: item.id,
      pool: "gpu",
      gpus: 1,
    })),
    pools: { gpu: 1 },
    sleep: async () => {
      kube.tick();
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
  });
  return { kube, controller };
}

test("Bifrost-compatible streaming request calls direct Radiance and holds admission until output drains", async (context) => {
  const { controller } = runtime(
    [{ id: "text", kind: "text", url: "http://radiance.internal:8000" }],
    ["text"],
  );
  let releaseStream: (() => void) | undefined;
  const source = new ReadableStream({
    start(stream) {
      stream.enqueue(
        new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
      );
      releaseStream = () => {
        stream.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        stream.close();
      };
    },
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/local-text",
    createTextAdmissionRouter({
      controller,
      workloadId: "text",
      apiKey: "fixture-radiance-key",
      fetchImpl: (async (url, options) => {
        assert.equal(url, "http://radiance.internal:8000/v1/chat/completions");
        assert.equal(
          (options?.headers as Record<string, string>).Authorization,
          "Bearer fixture-radiance-key",
        );
        assert.deepEqual(JSON.parse(options?.body as string), {
          model: "local",
          stream: true,
          messages: [{ role: "user", content: "Hello" }],
        });
        return new Response(source, { headers: { "Content-Type": "text/event-stream" } });
      }) as typeof fetch,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await once(server, "listening");
  const address = server.address() as { port: number };
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/local-text/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer gateway-key" },
      body: JSON.stringify({
        model: "local",
        stream: true,
        messages: [{ role: "user", content: "Hello" }],
      }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(controller.status()[0].acceptedOperations, 1);
  releaseStream!();
  assert.match(await response.text(), /data: \[DONE\]/);
  assert.equal(controller.status()[0].acceptedOperations, 0);
});

test("caller disconnect drains the real Radiance response and blocks conflicting media until completion", async (context) => {
  let finishUpstream!: () => void;
  let upstreamClosed = false;
  const upstream = http.createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Consume the submitted completion request. */
    }
    response.once("close", () => {
      upstreamClosed = true;
    });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
    finishUpstream = () => response.end("data: [DONE]\n\n");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  context.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const address = upstream.address() as { port: number };
  const { kube, controller } = runtime(
    [
      { id: "text", kind: "text", url: `http://127.0.0.1:${address.port}` },
      { id: "media", kind: "image", url: "http://comfy.invalid" },
    ],
    ["text"],
  );
  let markReleased!: () => void;
  const released = new Promise<void>((resolve) => {
    markReleased = resolve;
  });
  const acquire = controller.acquire.bind(controller);
  controller.acquire = async (id) => {
    const lease = await acquire(id);
    return {
      ...lease,
      release: () => {
        lease.release();
        markReleased();
      },
    };
  };
  let markDisconnected!: () => void;
  const disconnected = new Promise<void>((resolve) => {
    markDisconnected = resolve;
  });
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => {
    response.once("close", markDisconnected);
    next();
  });
  app.use(createTextAdmissionRouter({ controller, workloadId: "text", apiKey: "fixture" }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const studio = server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${studio.port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stream: true }),
  });
  assert.equal(controller.status()[0].acceptedOperations, 1);
  await response.body!.cancel();
  await disconnected;
  assert.equal(upstreamClosed, false, "closing the caller must not cancel Radiance's response");
  assert.equal(controller.status()[0].acceptedOperations, 1);
  // An administrator gives the GPU to media: the switch begins but waits for the open text stream.
  const preview = await controller.preview(["media"]);
  await controller.apply(["media"], preview.signature, "account:admin");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(
    (await controller.observe()).operation!.progress,
    /Waiting for 1 accepted operation on text/,
  );
  assert.deepEqual(kube.log, []);
  finishUpstream();
  await released;
  assert.equal(controller.status()[0].acceptedOperations, 0);
  await controller.settled;
  assert.deepEqual(kube.log, ["scale gpu/text 0", "gone gpu/text", "scale gpu/media 1"]);
  (await controller.acquire("media")).release();
});

test("administrator runtime routes preview, apply and report operations, with plain refusals", async (context) => {
  const { kube, controller } = runtime(
    [
      { id: "text", kind: "text", url: "http://text.invalid" },
      { id: "media", kind: "image", url: "http://media.invalid" },
    ],
    ["text"],
  );
  const app = express();
  app.use(express.json());
  app.use(createRuntimeRouter(controller, () => "account:admin"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const send = async (path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const status = await send("/");
  assert.deepEqual(
    status.body.workloads.map((item: { id: string; phase: string }) => [item.id, item.phase]),
    [
      ["text", "running"],
      ["media", "stopped"],
    ],
  );
  assert.deepEqual(await send("/preview", { workloads: "media" }), {
    status: 400,
    body: { error: "workloads must list workload ids." },
  });
  assert.equal((await send("/preview", { workloads: ["text", "media"] })).status, 400);
  const preview = await send("/preview", { workloads: ["media"] });
  assert.deepEqual(preview.body.stop, ["text"]);
  assert.equal((await send("/apply", { workloads: ["media"], signature: "stale" })).status, 409);
  const applied = await send("/apply", { workloads: ["media"], signature: preview.body.signature });
  assert.equal(applied.status, 202);
  assert.equal(applied.body.requestedBy, "account:admin");
  await controller.settled;
  assert.equal((await send(`/operations/${applied.body.id}`)).body.status, "completed");
  assert.deepEqual(kube.log, ["scale gpu/text 0", "gone gpu/text", "scale gpu/media 1"]);
  assert.deepEqual(await send("/restart", { workload: "text" }), {
    status: 409,
    body: { error: "text is not running; only a running workload can be restarted." },
  });
});
