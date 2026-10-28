import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { fakeKubernetes } from "../fixtures/fake-kubernetes.ts";
import { RuntimeController, type Workload } from "./controller.ts";
import { KubernetesEngine } from "./kubernetes.ts";
import { createRuntimeRouter } from "./routes.ts";

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
  const start = await send("/preview", { start: ["media"] });
  assert.deepEqual([start.body.target, start.body.signature], [["media"], preview.body.signature]);
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
