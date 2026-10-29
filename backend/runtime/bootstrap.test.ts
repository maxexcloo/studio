import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fakeKubernetes } from "../fixtures/fake-kubernetes.ts";
import { closeRuntimeDatabase } from "../persistence/runtime.ts";
import { loadRuntime } from "./bootstrap.ts";
import type { KubernetesRequest } from "./kubernetes.ts";

const environment = (extra = {}) => ({
  STUDIO_KUBERNETES_GPUS: JSON.stringify({ gpu: 2, gaming: 1 }),
  STUDIO_KUBERNETES_NAMESPACES: "comfyui, text",
  STUDIO_KUBERNETES_URL: "http://kubernetes.invalid",
  STUDIO_LOCAL_TEXT_MODEL: "local/auto",
  STUDIO_TEXT_KEY: "fixture-text",
  ...extra,
});
const image = { kind: "image", pool: "gpu", gpus: 1, url: "http://127.0.0.1:8188" };

/** Two namespaces shaped like the app-template releases: one Service can select several deployments. */
function cluster(change: (items: Record<string, any>) => void = () => {}) {
  const deployment = (
    name: string,
    kind: string,
    labels: Record<string, string>,
    nodeSelector: Record<string, string>,
    template: string,
    annotations: Record<string, string> = {},
  ) => ({
    metadata: { name, labels: { "studio.excloo.dev/kind": kind }, annotations },
    spec: {
      template: {
        metadata: { labels },
        spec: {
          nodeSelector,
          resourceClaims: [{ name: "gpu", resourceClaimTemplateName: template }],
        },
      },
    },
  });
  const service = (name: string, selector: Record<string, string>, port: number) => ({
    metadata: { name },
    spec: { selector, ports: [{ name: "http", port }] },
  });
  const templates = [1, 2].map((count) => ({
    metadata: { name: `gpu-${count}` },
    spec: {
      spec: {
        devices: {
          requests: [{ name: "gpu", exactly: { deviceClassName: "gpu", count } }],
        },
      },
    },
  }));
  const items: Record<string, any> = {
    "comfyui/deployments": [
      deployment(
        "comfyui",
        "image",
        { "app.kubernetes.io/name": "comfyui", "app.kubernetes.io/controller": "comfyui" },
        { "node.excloo.dev/dedicated": "gpu", "node.excloo.dev/network": "internal" },
        "gpu-1",
        {
          "studio.excloo.dev/label": "Image",
          "studio.excloo.dev/worker": "primary",
          "studio.excloo.dev/capabilities": "image,upscale,models",
        },
      ),
    ],
    "comfyui/services": [service("comfyui", { "app.kubernetes.io/name": "comfyui" }, 8188)],
    "comfyui/resourceclaimtemplates": templates,
    "text/deployments": [
      deployment(
        "text-gemma-tp2",
        "text",
        { "text.excloo.dev/model": "gemma" },
        { "node.excloo.dev/dedicated": "gpu" },
        "gpu-2",
      ),
      deployment(
        "text-gemma",
        "text",
        { "text.excloo.dev/model": "gemma" },
        { "node.excloo.dev/dedicated": "gaming" },
        "gpu-1",
        { "studio.excloo.dev/label": "Gemma", "studio.excloo.dev/vision": "true" },
      ),
    ],
    "text/services": [
      service("gemma", { "text.excloo.dev/model": "gemma" }, 8000),
      service("maya", { "text.excloo.dev/model": "maya" }, 8000),
    ],
    "text/resourceclaimtemplates": templates,
  };
  change(items);
  const request: KubernetesRequest = async (_method, path) => {
    const [, namespace, resource] = /namespaces\/([^/]+)\/([a-z]+)/.exec(path)!;
    return { status: 200, body: { items: items[`${namespace}/${resource}`] } };
  };
  return request;
}

test("workloads come from the labelled deployments, their claims and the Service selecting them", async () => {
  const runtime = await loadRuntime(environment(), { request: cluster() });
  assert.deepEqual(runtime!.controller.pools, { gpu: 2, gaming: 1 });
  assert.deepEqual(runtime!.controller.workloads, [
    {
      id: "comfyui",
      label: "Image",
      kind: "image",
      namespace: "comfyui",
      deployment: "comfyui",
      pool: "gpu",
      gpus: 1,
      url: "http://comfyui.comfyui.svc.cluster.local:8188",
      worker: "primary",
      capabilities: ["image", "upscale", "models"],
    },
    {
      id: "text-gemma",
      label: "Gemma",
      kind: "text",
      namespace: "text",
      deployment: "text-gemma",
      pool: "gaming",
      gpus: 1,
      url: "http://gemma.text.svc.cluster.local:8000",
      model: "local/auto",
      vision: true,
    },
    {
      id: "text-gemma-tp2",
      label: "text-gemma-tp2",
      kind: "text",
      namespace: "text",
      deployment: "text-gemma-tp2",
      pool: "gpu",
      gpus: 2,
      url: "http://gemma.text.svc.cluster.local:8000",
      model: "local/auto",
    },
  ]);
});

test("without namespaces there is no runtime; what can't be derived stops Studio by name", async () => {
  assert.equal(await loadRuntime({}), undefined);
  await assert.rejects(
    loadRuntime({ STUDIO_KUBERNETES_NAMESPACES: "text", STUDIO_KUBERNETES_URL: "http://k" }),
    /STUDIO_KUBERNETES_GPUS is required/,
  );
  const { STUDIO_LOCAL_TEXT_MODEL: _model, ...withoutModel } = environment();
  await assert.rejects(
    loadRuntime(withoutModel, { request: cluster() }),
    /STUDIO_LOCAL_TEXT_MODEL is required/,
  );
  for (const [change, message] of [
    [
      (items: Record<string, any>) =>
        (items["comfyui/deployments"][0].spec.template.spec.nodeSelector = {}),
      /comfyui\/comfyui needs a node selector value naming one STUDIO_KUBERNETES_GPUS pool/,
    ],
    [
      (items: Record<string, any>) =>
        (items["text/deployments"][0].spec.template.spec.nodeSelector = {
          "node.excloo.dev/dedicated": "gaming",
        }),
      /text\/text-gemma-tp2 claims 2 GPUs; the gaming pool has 1/,
    ],
    [
      (items: Record<string, any>) =>
        items["text/services"].push({
          metadata: { name: "all" },
          spec: {
            selector: { "text.excloo.dev/model": "gemma" },
            ports: [{ port: 80 }],
          },
        }),
      /text\/text-gemma-tp2 needs one Service selecting its pods, not 2/,
    ],
  ] as const)
    await assert.rejects(loadRuntime(environment(), { request: cluster(change) }), message);
});

test("in-cluster access needs the mounted service account", async () => {
  const { STUDIO_KUBERNETES_URL: _url, ...inCluster } = environment();
  await assert.rejects(
    loadRuntime({ ...inCluster, KUBERNETES_SERVICE_HOST: "10.0.0.1" }),
    /needs Studio's in-cluster service account token \(automountServiceAccountToken\) or STUDIO_KUBERNETES_URL/,
  );
});

test("automatic control is off by default", async () => {
  const request = cluster();
  assert.equal(
    (await loadRuntime(environment(), { request }))!.controller.automaticLifecycle,
    false,
  );
  assert.equal(
    (await loadRuntime(environment({ STUDIO_RUNTIME_AUTOMATIC: "1" }), { request }))!.controller
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
  const kube = fakeKubernetes(
    [{ namespace: "comfyui", name: "comfyui", replicas: 1, workload: image }],
    { tickOnRead: true },
  );
  const options = { dataDir, request: kube.request };
  const first = (await loadRuntime(environment(), options))!.controller;
  const operation = await first.restart("comfyui", "account:admin");
  await first.settled;
  const later = (await loadRuntime(environment(), options))!.controller;
  const recorded = later.operation(operation.id);
  assert.equal(recorded.status, "completed");
  assert.equal(recorded.requestedBy, "account:admin");
  assert.deepEqual(recorded.before, ["comfyui"]);
  assert.deepEqual(recorded.after, ["comfyui"]);
  assert.ok(recorded.steps.length >= 2);
  assert.deepEqual(kube.log, [
    "scale comfyui/comfyui 0",
    "gone comfyui/comfyui",
    "scale comfyui/comfyui 1",
  ]);
});
