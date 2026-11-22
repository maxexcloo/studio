import assert from "node:assert/strict";
import test from "node:test";

import type { BenchmarkRun } from "../../shared/runtime.ts";
import { Benchmarks, benchmarkJob, parseBenchmarkLog } from "./benchmarks.ts";
import type { Workload } from "./controller.ts";
import type { KubernetesRequest } from "./kubernetes.ts";

const radiance: Workload = {
  id: "radiance",
  label: "Radiance",
  kind: "image",
  namespace: "radiance",
  deployment: "radiance",
  pool: "gpu",
  gpus: 2,
  url: "http://radiance.radiance.svc.cluster.local:8000",
  capabilities: ["image", "text", "video"],
  backend: "radiance",
  model: "local/auto",
};
const qwen = "qwen3.8-27b-iq4r";
const gemma = "gemma-4-31b-heretic";
const textModels = async () => [
  { id: "local/auto", label: "Auto" },
  { id: `local/${qwen}`, label: "Qwen 3.8 27B" },
  { id: `local/${gemma}`, label: "Gemma 4 31B" },
  { id: "local/stale", label: "Stale" },
  { id: "local/failed", label: "Failed" },
  { id: `cloud/${qwen}`, label: "Cloud Qwen" },
];
const modelResponse = () =>
  Response.json({
    data: [
      { id: qwen, state: "resident" },
      { id: gemma, state: "cold" },
      { id: "qwen-image", state: "resident" },
      { id: "failed", state: "failed" },
    ],
  });
const summaryLine = `STUDIO-BENCHMARK {"version": "0.9.0", "decode": 61.2, "ttftMs": 140.5, "aggregate": {"level": 8, "tps": 290.1}, "prefill": {"depth": 64000, "tps": 4100.0}}`;

test("the Job benchmarks the workload's own endpoint with the key from its namespace's secret", () => {
  const job = benchmarkJob({
    name: "studio-benchmark-1a2b3c4d",
    workload: radiance,
    model: qwen,
    image: "ghcr.io/maxexcloo/betterbench:v0.6.1-1",
    secret: "radiance",
  });
  assert.equal(job.metadata.namespace, "radiance");
  assert.equal(job.spec.backoffLimit, 0);
  const pod = job.spec.template.spec;
  assert.equal(pod.restartPolicy, "Never");
  assert.equal(pod.automountServiceAccountToken, false);
  // runAsNonRoot accepts only a numeric user.
  assert.equal(pod.securityContext.runAsUser, 1000);
  assert.equal(job.spec.template.metadata.labels["app.kubernetes.io/name"], "betterbench");
  const [container] = pod.containers;
  assert.equal(container.image, "ghcr.io/maxexcloo/betterbench:v0.6.1-1");
  assert.deepEqual(container.command.slice(-2), [
    "http://radiance.radiance.svc.cluster.local:8000/v1",
    qwen,
  ]);
  assert.deepEqual(container.env, [
    {
      name: "BETTERBENCH_API_KEY",
      valueFrom: { secretKeyRef: { name: "radiance", key: "API_KEY" } },
    },
  ]);
});

test("the summary is the log's last marked line; a log without one has none", () => {
  assert.deepEqual(parseBenchmarkLog(`wrote /data/results.json\n${summaryLine}\n`), {
    version: "0.9.0",
    decode: 61.2,
    ttftMs: 140.5,
    aggregate: { level: 8, tps: 290.1 },
    prefill: { depth: 64000, tps: 4100 },
  });
  assert.deepEqual(
    parseBenchmarkLog(
      'STUDIO-BENCHMARK {"version": "0.9.0", "decode": null, "ttftMs": null, "aggregate": null, "prefill": null}',
    ),
    { version: "0.9.0", decode: null, ttftMs: null, aggregate: null, prefill: null },
  );
  assert.equal(parseBenchmarkLog("Traceback (most recent call last):\nKeyError"), undefined);
  assert.equal(parseBenchmarkLog("STUDIO-BENCHMARK {truncated"), undefined);
});

test("a benchmark batch runs one Job at a time and resumes its queued model after restart", async () => {
  const calls: string[] = [];
  let job: Record<string, any> = {};
  let persisted: BenchmarkRun[] = [];
  const posted: ReturnType<typeof benchmarkJob>[] = [];
  const request: KubernetesRequest = async (method, path, body) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    if (method === "POST") {
      const submitted = body as ReturnType<typeof benchmarkJob>;
      if (posted.some((job) => job.metadata.name === submitted.metadata.name))
        return { status: 409, body };
      assert.ok(persisted.some((run) => submitted.metadata.name === `studio-benchmark-${run.id}`));
      posted.push(submitted);
      // The first Job exists, but Studio never heard back.
      return { status: posted.length === 1 ? 503 : 201, body };
    }
    if (path.includes("/jobs/")) return { status: 200, body: job };
    if (path.endsWith("/log?tailLines=20")) return { status: 200, body: `done\n${summaryLine}\n` };
    if (path.includes("tailLines=50"))
      return { status: 200, body: "2026-11-16T10:00:00Z warming up\n2026-11-16T10:00:01Z done\n" };
    return {
      status: 200,
      body: {
        items: [
          {
            metadata: { name: "bench-pod" },
            spec: { containers: [{ name: "bench" }] },
            status: { phase: "Succeeded" },
          },
        ],
      },
    };
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    assert.equal(url, "http://radiance.radiance.svc.cluster.local:8000/v1/models");
    assert.deepEqual(init.headers, { authorization: "Bearer fixture-key" });
    return modelResponse();
  }) as typeof fetch;
  const options = {
    request,
    workloads: [radiance],
    environment: {
      STUDIO_BENCHMARK_IMAGE: "ghcr.io/maxexcloo/betterbench:v0.6.1-1",
      STUDIO_BENCHMARK_SECRET: "radiance",
      STUDIO_RADIANCE_KEY: "fixture-key",
    },
    fetchImpl,
    textModels,
    store: {
      read: () => structuredClone(persisted),
      write: (runs: BenchmarkRun[]) => {
        persisted = structuredClone(runs);
      },
    },
    pollMs: 60_000,
  };
  const benchmarks = new Benchmarks(options);
  assert.deepEqual(await benchmarks.models("radiance"), [
    { id: qwen, label: "Qwen 3.8 27B" },
    { id: gemma, label: "Gemma 4 31B" },
  ]);
  await assert.rejects(benchmarks.start("radiance", "account:admin", []), /Choose available/);
  await assert.rejects(
    benchmarks.start("radiance", "account:admin", [gemma, "qwen-image"]),
    /Choose available/,
  );
  assert.equal(posted.length, 0);
  // A second start while the first checks its model is refused.
  const [first, second] = await Promise.allSettled([
    benchmarks.start("radiance", "account:admin", [gemma, qwen]),
    benchmarks.start("radiance", "account:admin", [qwen]),
  ]);
  assert.match(String((second as PromiseRejectedResult).reason), /already running/);
  const [run, waiting] = (first as PromiseFulfilledResult<BenchmarkRun[]>).value;
  assert.equal(waiting.model, qwen);
  assert.equal(waiting.status, "queued");
  assert.equal(posted.length, 1);
  assert.equal(run.model, gemma);
  const [submitted] = posted;
  assert.equal(submitted.spec.template.spec.containers[0].command.at(-1), gemma);
  assert.equal(run.requestedBy, "account:admin");
  assert.equal(run.status, "queued");
  assert.deepEqual(calls, ["POST /apis/batch/v1/namespaces/radiance/jobs"]);
  await assert.rejects(benchmarks.start("radiance", "account:admin", [qwen]), /already running/);

  const restarted = new Benchmarks(options);
  await restarted.poll();
  assert.equal(restarted.list().runs[0].status, "running");
  assert.equal(posted.length, 1);
  job = { status: { succeeded: 1 } };
  await Promise.all([restarted.poll(), restarted.poll()]);
  const [running, done] = restarted.list().runs;
  assert.equal(running.id, waiting.id);
  assert.equal(running.status, "running");
  assert.equal(posted.length, 2);
  assert.equal(posted[1].spec.template.spec.containers[0].command.at(-1), qwen);
  assert.equal(done.status, "completed");
  assert.equal(done.summary?.decode, 61.2);
  assert.ok(calls.includes("GET /api/v1/namespaces/radiance/pods/bench-pod/log"));
  // Its log shows the Job pod's tail, as a workload's log does.
  assert.deepEqual(await benchmarks.logs(run.id, 50), {
    pods: [
      {
        name: "bench-pod",
        container: "bench",
        phase: "Succeeded",
        restarts: 0,
        lines: ["2026-11-16T10:00:00Z warming up", "2026-11-16T10:00:01Z done"],
      },
    ],
  });
  await assert.rejects(benchmarks.logs("gone", 50), /gone/);
});

test("a dropped benchmark Job holds the next model until its last pod is gone", async () => {
  let deleted = "";
  let jobGone = false;
  let podGone = false;
  const posted: unknown[] = [];
  let saved: BenchmarkRun[] = [];
  let job: Record<string, unknown> = { failed: 1 };
  const request: KubernetesRequest = async (method, path, body) => {
    if (method === "POST") {
      posted.push(body);
      return { status: 201, body };
    }
    if (method === "DELETE") {
      deleted = path;
      return { status: jobGone ? 404 : 202, body: {} };
    }
    if (path.includes("/jobs/")) return { status: 200, body: { status: job } };
    if (path.includes("/log"))
      return { status: 200, body: "phases: decode\nHTTP 401 Unauthorized\n" };
    return {
      status: 200,
      body: { items: podGone ? [] : [{ metadata: { name: "bench-pod" } }] },
    };
  };
  const options = {
    request,
    workloads: [radiance],
    environment: { STUDIO_BENCHMARK_IMAGE: "image", STUDIO_BENCHMARK_SECRET: "radiance" },
    fetchImpl: (async () => modelResponse()) as typeof fetch,
    textModels,
    pollMs: 60_000,
    store: {
      read: () => structuredClone(saved),
      write: (runs: BenchmarkRun[]) => {
        saved = structuredClone(runs);
      },
    },
  };
  const benchmarks = new Benchmarks(options);
  await benchmarks.start("radiance", "local", [qwen]);
  await benchmarks.poll();
  assert.equal(benchmarks.list().runs[0].status, "failed");
  assert.equal(benchmarks.list().runs[0].error, "HTTP 401 Unauthorized");

  job = {
    failed: 1,
    conditions: [
      { type: "Failed", reason: "DeadlineExceeded", message: "Job was active too long" },
    ],
  };
  await benchmarks.start("radiance", "local", [qwen]);
  await benchmarks.poll();
  assert.equal(benchmarks.list().runs[0].error, "Job was active too long");

  job = {};
  const [second, third] = await benchmarks.start("radiance", "local", [qwen, gemma]);
  const before = posted.length;
  assert.equal((await benchmarks.stop(second.id)).status, "stopping");
  assert.equal(saved.find(({ id }) => id === second.id)?.status, "stopping");
  assert.match(
    deleted,
    new RegExp(`/jobs/studio-benchmark-${second.id}\\?propagationPolicy=Foreground$`),
  );

  const restarted = new Benchmarks(options);
  await restarted.poll();
  jobGone = true;
  await restarted.poll();
  assert.equal(restarted.list().runs[0].status, "stopping");
  assert.equal(posted.length, before);
  podGone = true;
  await restarted.poll();
  assert.equal(posted.length, before + 1);
  assert.equal(restarted.list().runs[0].id, third.id);
  assert.equal(restarted.list().runs[0].status, "running");
  assert.equal(restarted.list().runs[1].status, "stopped");

  // A Job that ended before Stop keeps its outcome and isn't deleted.
  deleted = "";
  job = { failed: 1 };
  assert.equal((await restarted.stop(third.id)).status, "failed");
  assert.deepEqual(
    restarted
      .list()
      .runs.slice(0, 2)
      .map((run) => run.id),
    [third.id, second.id],
  );
  assert.equal(deleted, "");
});

test("a stopped model refuses a benchmark before any Job starts", async () => {
  const benchmarks = new Benchmarks({
    request: async () => assert.fail("no Kubernetes call"),
    workloads: [radiance],
    environment: { STUDIO_BENCHMARK_IMAGE: "image", STUDIO_BENCHMARK_SECRET: "radiance" },
    fetchImpl: (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch,
  });
  await assert.rejects(
    benchmarks.start("radiance", "local", [qwen]),
    /Radiance isn't answering: start it first/,
  );
  assert.deepEqual(benchmarks.list().runs, []);
});
