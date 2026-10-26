import assert from "node:assert/strict";
import test from "node:test";
import { KubernetesEngine, urlRequest, type KubernetesRequest } from "./kubernetes.ts";

const target = { namespace: "text", deployment: "text-qwen" };

test("state reads the deployment, then its pods by selector, with the first reason a pod waits", async () => {
  const calls: string[] = [];
  const request: KubernetesRequest = async (method, path) => {
    calls.push(`${method} ${path}`);
    if (path.includes("/deployments/"))
      return {
        status: 200,
        body: {
          spec: {
            replicas: 1,
            selector: { matchLabels: { "app.kubernetes.io/controller": "qwen" } },
          },
          status: {},
        },
      };
    return {
      status: 200,
      body: {
        items: [
          {
            status: {
              phase: "Pending",
              containerStatuses: [
                { state: { waiting: { reason: "ImagePullBackOff", message: "Back-off pulling" } } },
              ],
            },
          },
        ],
      },
    };
  };
  assert.deepEqual(await new KubernetesEngine(request).state(target), {
    replicas: 1,
    ready: 0,
    pods: 1,
    reason: "ImagePullBackOff: Back-off pulling",
  });
  assert.deepEqual(calls, [
    "GET /apis/apps/v1/namespaces/text/deployments/text-qwen",
    "GET /api/v1/namespaces/text/pods?labelSelector=app.kubernetes.io%2Fcontroller%3Dqwen",
  ]);
});

test("scale patches only the scale subresource, and failures say what to fix without cluster detail", async () => {
  const sent: { url: string; method?: string; type?: string | null; body?: unknown }[] = [];
  const engine = new KubernetesEngine(
    urlRequest("http://127.0.0.1:8001/", (async (url, init) => {
      sent.push({
        url: String(url),
        method: init?.method,
        type: new Headers(init?.headers).get("content-type"),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json({});
    }) as typeof fetch),
  );
  await engine.scale(target, 0);
  assert.deepEqual(sent, [
    {
      url: "http://127.0.0.1:8001/apis/apps/v1/namespaces/text/deployments/text-qwen/scale",
      method: "PATCH",
      type: "application/merge-patch+json",
      body: { spec: { replicas: 0 } },
    },
  ]);
  const failing = (status: number) =>
    new KubernetesEngine(async () => ({ status, body: { message: "internal cluster detail" } }));
  await assert.rejects(failing(401).scale(target, 1), {
    status: 503,
    message: "Kubernetes refused Studio's service account token.",
  });
  await assert.rejects(failing(403).scale(target, 1), {
    message:
      "Studio's service account may not scale text/text-qwen; apply Studio's runtime role in text.",
  });
  await assert.rejects(failing(404).state(target), {
    message: "Kubernetes has no deployment text/text-qwen.",
  });
  await assert.rejects(failing(500).state(target), {
    message: "Kubernetes returned HTTP 500 for text/text-qwen.",
  });
  await assert.rejects(
    new KubernetesEngine(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.1:443");
    }).state(target),
    { message: "The Kubernetes API is unavailable." },
  );
});
