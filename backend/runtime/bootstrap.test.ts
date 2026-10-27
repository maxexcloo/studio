import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fakeKubernetes } from "../fixtures/fake-kubernetes.ts";
import { closeRuntimeDatabase } from "../persistence/runtime.ts";
import { loadRuntime } from "./bootstrap.ts";

const image = {
  kind: "image",
  namespace: "comfyui",
  deployment: "comfyui",
  pool: "gpu",
  gpus: 1,
  url: "http://comfyui.comfyui.svc:8188",
};
const environment = (workloads: Record<string, unknown> = { image }, extra = {}) => ({
  STUDIO_KUBERNETES_GPUS: JSON.stringify({ gpu: 2 }),
  STUDIO_KUBERNETES_WORKLOADS: JSON.stringify(workloads),
  STUDIO_KUBERNETES_URL: "http://kubernetes.invalid",
  ...extra,
});

test("without workloads there is no runtime; malformed configuration fails with the setting's name", () => {
  assert.equal(loadRuntime({}), undefined);
  assert.throws(
    () => loadRuntime({ STUDIO_KUBERNETES_WORKLOADS: "{}" }),
    /STUDIO_KUBERNETES_GPUS is required/,
  );
  assert.throws(
    () => loadRuntime({ ...environment(), STUDIO_KUBERNETES_WORKLOADS: "{" }),
    /STUDIO_KUBERNETES_WORKLOADS is not valid JSON/,
  );
  for (const [change, message] of [
    [{ kind: "audio" }, /image needs a kind of image, video or text/],
    [{ deployment: "" }, /image needs deployment/],
    [{ pool: "gaming" }, /image names pool gaming, which has no GPUs/],
    [{ gpus: 3 }, /image needs gpus between 1 and the gpu pool's 2/],
    [{ url: "http://user:secret@comfyui:8188" }, /image needs a direct worker URL/],
    [{ apiKeyEnv: "STUDIO_FIXTURE_MISSING_KEY" }, /STUDIO_FIXTURE_MISSING_KEY is required/],
  ] as const)
    assert.throws(() => loadRuntime(environment({ image: { ...image, ...change } })), message);
  assert.throws(
    () =>
      loadRuntime(
        environment(
          { text: { ...image, kind: "text", url: "http://bifrost:8080" } },
          { STUDIO_BIFROST_URL: "http://bifrost:8080" },
        ),
      ),
    /must point directly to its worker, not Bifrost/,
  );
});

test("in-cluster access needs the mounted service account", () => {
  const { STUDIO_KUBERNETES_URL: _url, ...inCluster } = environment();
  assert.throws(
    () => loadRuntime({ ...inCluster, KUBERNETES_SERVICE_HOST: "10.0.0.1" }),
    /needs Studio's in-cluster service account token \(automountServiceAccountToken\) or STUDIO_KUBERNETES_URL/,
  );
});

test("automatic control is off by default", () => {
  assert.equal(loadRuntime(environment())!.controller.automaticLifecycle, false);
  assert.equal(
    loadRuntime(environment(undefined, { STUDIO_RUNTIME_AUTOMATIC: "1" }))!.controller
      .automaticLifecycle,
    true,
  );
});

test("runtime changes are recorded in the data folder and outlive the process", async (context) => {
  const dataDir = mkdtempSync(join(tmpdir(), "studio-runtime-history-"));
  context.after(() => {
    closeRuntimeDatabase(dataDir);
    rmSync(dataDir, { recursive: true, force: true });
  });
  const kube = fakeKubernetes([{ namespace: "comfyui", name: "comfyui", replicas: 1 }], {
    tickOnRead: true,
  });
  const first = loadRuntime(environment(), { dataDir, request: kube.request })!.controller;
  const operation = await first.restart("image", "account:admin");
  await first.settled;
  const later = loadRuntime(environment(), { dataDir, request: kube.request })!.controller;
  const recorded = later.operation(operation.id);
  assert.equal(recorded.status, "completed");
  assert.equal(recorded.requestedBy, "account:admin");
  assert.deepEqual(recorded.before, ["image"]);
  assert.deepEqual(recorded.after, ["image"]);
  assert.ok(recorded.steps.length >= 2);
  assert.deepEqual(kube.log, [
    "scale comfyui/comfyui 0",
    "gone comfyui/comfyui",
    "scale comfyui/comfyui 1",
  ]);
});
