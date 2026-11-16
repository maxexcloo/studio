import assert from "node:assert/strict";
import test from "node:test";

import type { BenchmarkRun } from "../../shared/runtime.ts";
import { Benchmarks, benchmarkJob, parseBenchmarkLog } from "./benchmarks.ts";
import type { Workload } from "./controller.ts";
import type { KubernetesRequest } from "./kubernetes.ts";

const gemma: Workload = {
  id: "gemma",
  label: "Gemma",
  kind: "text",
  namespace: "text",
  deployment: "gemma",
  pool: "gpu",
  gpus: 1,
  url: "http://gemma.text.svc.cluster.local:8000",
  model: "local/auto",
};
const summaryLine = `STUDIO-BENCHMARK {"version": "0.9.0", "decode": 61.2, "ttftMs": 140.5, "aggregate": {"level": 8, "tps": 290.1}, "prefill": {"depth": 64000, "tps": 4100.0}}`;

test("the Job benchmarks the workload's own endpoint with the key from its namespace's secret", () => {
  const job = benchmarkJob({
    name: "studio-benchmark-1a2b3c4d",
    workload: gemma,
    model: "gemma-4-31b",
    image: "ghcr.io/maxexcloo/betterbench:v0.6.1-1",
    secret: "text",
  });
  assert.equal(job.metadata.namespace, "text");
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
    "http://gemma.text.svc.cluster.local:8000/v1",
    "gemma-4-31b",
  ]);
  assert.deepEqual(container.env, [
    {
      name: "BETTERBENCH_API_KEY",
      valueFrom: { secretKeyRef: { name: "text", key: "API_KEY" } },
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

test("a run creates its Job, reads the summary once it succeeds and refuses a second meanwhile", async () => {
  const calls: string[] = [];
  let job: Record<string, any> = {};
  const request: KubernetesRequest = async (method, path, body) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    if (method === "POST") return { status: 201, body };
    if (path.includes("/jobs/")) return { status: 200, body: job };
    if (path.endsWith("/log?tailLines=20")) return { status: 200, body: `done\n${summaryLine}\n` };
    if (path.endsWith("/log?tailLines=50&timestamps=true"))
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
    assert.equal(url, "http://gemma.text.svc.cluster.local:8000/v1/models");
    assert.deepEqual(init.headers, { Authorization: "Bearer fixture-text" });
    return Response.json({ data: [{ id: "gemma-4-31b" }] });
  }) as typeof fetch;
  const benchmarks = new Benchmarks({
    request,
    workloads: [gemma],
    environment: {
      STUDIO_BENCHMARK_IMAGE: "ghcr.io/maxexcloo/betterbench:v0.6.1-1",
      STUDIO_BENCHMARK_SECRET: "text",
      STUDIO_TEXT_KEY: "fixture-text",
    },
    fetchImpl,
    pollMs: 60_000,
  });
  // A second start while the first checks its model is refused.
  const [first, second] = await Promise.allSettled([
    benchmarks.start("gemma", "account:admin"),
    benchmarks.start("gemma", "account:admin"),
  ]);
  assert.match(String((second as PromiseRejectedResult).reason), /already running/);
  const run = (first as PromiseFulfilledResult<BenchmarkRun>).value;
  assert.equal(run.model, "gemma-4-31b");
  assert.equal(run.requestedBy, "account:admin");
  assert.equal(run.status, "running");
  assert.deepEqual(calls, ["POST /apis/batch/v1/namespaces/text/jobs"]);
  await assert.rejects(benchmarks.start("gemma", "account:admin"), /already running/);

  await benchmarks.poll();
  assert.equal(benchmarks.list().runs[0].status, "running");
  job = { status: { succeeded: 1 } };
  await benchmarks.poll();
  const [done] = benchmarks.list().runs;
  assert.equal(done.status, "completed");
  assert.equal(done.summary?.decode, 61.2);
  assert.ok(calls.includes("GET /api/v1/namespaces/text/pods/bench-pod/log"));
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

test("a failed Job reports why, and Stop deletes a Job still running", async () => {
  let deleted = "";
  let job: Record<string, unknown> = { failed: 1 };
  const request: KubernetesRequest = async (method, path, body) => {
    if (method === "POST") return { status: 201, body };
    if (method === "DELETE") {
      deleted = path;
      return { status: 200, body: {} };
    }
    if (path.includes("/jobs/")) return { status: 200, body: { status: job } };
    if (path.includes("/log"))
      return { status: 200, body: "phases: decode\nHTTP 401 Unauthorized\n" };
    return { status: 200, body: { items: [{ metadata: { name: "bench-pod" } }] } };
  };
  const benchmarks = new Benchmarks({
    request,
    workloads: [gemma],
    environment: { STUDIO_BENCHMARK_IMAGE: "image", STUDIO_BENCHMARK_SECRET: "text" },
    fetchImpl: (async () => Response.json({ data: [{ id: "gemma-4-31b" }] })) as typeof fetch,
    pollMs: 60_000,
  });
  await benchmarks.start("gemma", "local");
  await benchmarks.poll();
  assert.equal(benchmarks.list().runs[0].status, "failed");
  assert.equal(benchmarks.list().runs[0].error, "HTTP 401 Unauthorized");

  job = {
    failed: 1,
    conditions: [
      { type: "Failed", reason: "DeadlineExceeded", message: "Job was active too long" },
    ],
  };
  await benchmarks.start("gemma", "local");
  await benchmarks.poll();
  assert.equal(benchmarks.list().runs[0].error, "Job was active too long");

  job = {};
  const second = await benchmarks.start("gemma", "local");
  await benchmarks.stop(second.id);
  assert.equal(second.status, "stopped");
  assert.match(
    deleted,
    new RegExp(`/jobs/studio-benchmark-${second.id}\\?propagationPolicy=Background$`),
  );

  // A Job that ended before Stop keeps its outcome and isn't deleted.
  deleted = "";
  const third = await benchmarks.start("gemma", "local");
  job = { failed: 1 };
  await benchmarks.stop(third.id);
  assert.equal(third.status, "failed");
  assert.deepEqual(
    benchmarks
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
    workloads: [gemma],
    environment: { STUDIO_BENCHMARK_IMAGE: "image", STUDIO_BENCHMARK_SECRET: "text" },
    fetchImpl: (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch,
  });
  await assert.rejects(benchmarks.start("gemma", "local"), /Gemma isn't answering: start it first/);
  assert.deepEqual(benchmarks.list().runs, []);
});
