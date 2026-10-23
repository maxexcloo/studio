import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServicesObserver } from "./services.ts";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { ServicesStatus } from "../../shared/services.ts";

test("service health observes direct runtimes, shares a bounded cache and scopes waiting and addresses to the caller", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "studio-health-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    join(directory, "workloads.json"),
    JSON.stringify({
      image: { kind: "image", placements: ["0", "1"], service: { url: "http://image.invalid" } },
      text: {
        kind: "text",
        placements: ["0,1"],
        service: { url: "http://text.invalid", display_label: "Direct Text" },
      },
      unbound: { kind: "text", label: "Unbound Text", placements: ["0"] },
      gateway: { kind: "text", service: { url: "http://gateway.invalid" } },
    }),
  );
  let time = 0;
  let textOffline = false;
  const calls: string[] = [];
  const observe = createServicesObserver({
    environment: {
      STUDIO_CONFIG_DIR: directory,
      STUDIO_CHAT_GATEWAY_URL: "http://gateway.invalid",
    },
    workers: () => [
      {
        id: "image-worker",
        name: "Image Worker",
        url: "http://image.invalid",
        capabilities: ["image"],
      },
      {
        id: "video-worker",
        name: "Video Worker",
        url: "http://video.invalid",
        capabilities: ["video"],
      },
    ],
    now: () => time,
    fetchImpl: async (input, options) => {
      const url = String(input);
      calls.push(url);
      assert.equal(options?.method, "GET");
      assert.equal(options?.redirect, "error");
      assert.ok(options?.signal instanceof AbortSignal);
      if (url === "http://image.invalid/system_stats")
        return Response.json({
          system: { comfyui_version: "fixture-version", secret: "never-return" },
          devices: [{ name: "Fixture GPU", vram_total: 100, vram_free: 40 }],
          privateJobs: ["foreign-job"],
        });
      if (url === "http://text.invalid/health")
        return new Response(null, { status: textOffline ? 503 : 200 });
      if (url === "http://video.invalid/system_stats")
        throw new Error("connection refused with private details");
      throw new Error("Unexpected request");
    },
  });
  const admin = await observe({ allowed: ["image", "video", "text"], administrator: true });
  assert.equal(admin.services.image?.state, "healthy");
  assert.equal(admin.services.video?.state, "offline");
  assert.equal(admin.services.text?.state, "healthy");
  assert.equal(admin.services.image?.endpoints[0].device, "Fixture GPU");
  assert.equal(admin.services.image?.endpoints[0].memoryFree, 40);
  assert.deepEqual(admin.services.image?.endpoints[0].placements, ["0", "1"]);
  assert.equal(
    admin.services.text?.endpoints.find((endpoint) => endpoint.id === "unbound")?.state,
    "unknown",
  );
  assert.equal(
    admin.services.text?.endpoints.find((endpoint) => endpoint.id === "gateway")?.state,
    "unknown",
  );
  assert.equal(admin.runtime.configured, false);
  assert.equal(admin.runtime.automaticLifecycle, false);
  assert.match(admin.runtime.reason, /not observed/);
  assert.doesNotMatch(JSON.stringify(admin), /never-return|foreign-job|private details/);
  assert.equal(
    calls.some((url) => /gateway|models|containers/.test(url)),
    false,
  );
  const ownWaiting = await observe({ allowed: ["video"], waitingWorkers: ["video-worker"] });
  assert.deepEqual(Object.keys(ownWaiting.services), ["video"]);
  assert.equal(ownWaiting.services.video?.state, "waiting");
  assert.equal(ownWaiting.services.video?.endpoints[0].endpoint, undefined);
  const unrelated = await observe({ allowed: ["video"] });
  assert.equal(
    unrelated.services.video?.state,
    "offline",
    "one caller's pending work does not alter another caller's cached health",
  );
  assert.equal(calls.length, 3);
  time = 6000;
  textOffline = true;
  const stopped = await observe({ allowed: ["text"] });
  assert.equal(
    stopped.services.text?.state,
    "offline",
    "unbound catalogue choices do not conceal an observed offline text runtime",
  );
  assert.equal(calls.length, 4);
});

test("timeouts, authentication failures and non-worker responses never advertise a healthy runtime", async () => {
  for (const outcome of ["timeout", "auth", "html"]) {
    const observe = createServicesObserver({
      workers: () => [
        { id: "image", name: "Image", url: "http://worker.invalid", capabilities: ["image"] },
      ],
      environment: {},
      fetchImpl: async () => {
        if (outcome === "timeout") throw new DOMException("timeout", "TimeoutError");
        return new Response(outcome === "html" ? "<html>not ComfyUI</html>" : null, {
          status: outcome === "auth" ? 401 : 200,
        });
      },
    });
    const result = await observe({ allowed: ["image", "text"] });
    assert.equal(result.services.image?.state, "unknown");
    assert.equal(result.services.text?.state, "unknown");
    assert.equal(result.services.text?.endpoints.length, 0);
  }
});

test(
  "HTTP service observation applies ordinary account feature gates and hides direct addresses",
  { timeout: 15_000 },
  async (context) => {
    const directory = mkdtempSync(join(tmpdir(), "studio-service-http-"));
    writeFileSync(join(directory, "lora-catalogue.json"), "{}");
    writeFileSync(join(directory, "prompting.json"), "{}");
    writeFileSync(join(directory, "models.json"), "[]");
    let healthCalls = 0;
    const worker = createServer((request, response) => {
      assert.equal(request.method, "GET");
      assert.equal(request.url, "/health");
      healthCalls++;
      response.end("ready");
    });
    worker.listen(0, "127.0.0.1");
    await once(worker, "listening");
    const workerUrl = `http://127.0.0.1:${(worker.address() as AddressInfo).port}`;
    writeFileSync(
      join(directory, "workloads.json"),
      JSON.stringify({ text: { kind: "text", placements: ["0"], service: { url: workerUrl } } }),
    );
    const server = fork(fileURLToPath(new URL("../index.js", import.meta.url)), [], {
      env: {
        PATH: process.env.PATH,
        PORT: "0",
        HOST: "127.0.0.1",
        STUDIO_ENV_FILE: "/dev/null",
        STUDIO_DATA_DIR: join(directory, "data"),
        STUDIO_CONFIG_DIR: directory,
        STUDIO_WORKERS: "[]",
        STUDIO_DEMO: "1",
        STUDIO_MULTI_USER: "1",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let startupErrors = "";
    server.stderr?.on("data", (chunk) => {
      startupErrors += String(chunk);
    });
    context.after(async () => {
      const stopped = server.exitCode === null ? once(server, "exit") : undefined;
      server.kill("SIGTERM");
      await stopped;
      worker.closeAllConnections();
      await new Promise<void>((resolve) => worker.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    });
    const [ready] = await Promise.race([
      once(server, "message"),
      once(server, "exit").then(() => {
        throw new Error(`Service fixture failed before readiness: ${startupErrors}`);
      }),
    ]);
    const base = String(ready.url).replace("localhost", "127.0.0.1");
    let cookie = "";
    async function api(route: string, method = "GET", body?: unknown): Promise<any> {
      const response = await fetch(base + route, {
        method,
        headers: { "content-type": "application/json", cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.equal(response.ok, true, `${route}: ${response.status}`);
      const next = response.headers
        .getSetCookie()
        .find((value) => value.startsWith("studio_account="));
      if (next) cookie = next.split(";")[0];
      return response.json();
    }
    await api("/api/accounts/bootstrap", "POST", {
      username: "administrator",
      password: "fixture administrator password",
    });
    const administratorCookie = cookie;
    const admin: ServicesStatus = await api("/api/services/status");
    assert.equal(admin.services.text?.state, "healthy");
    assert.equal(
      admin.services.image?.state,
      "unknown",
      "demo placeholders are not evidence of worker health",
    );
    assert.equal(admin.services.text?.endpoints[0].endpoint, `${workerUrl}/health`);
    assert.equal(admin.runtime.configured, false);
    const profile = async (promptAssistant: boolean) => {
      cookie = administratorCookie;
      await api("/api/accounts/profiles", "POST", {
        id: "observer",
        name: "Observer",
        allModels: true,
        features: { promptAssistant, imageGeneration: false, videoGeneration: false },
      });
    };
    await profile(true);
    await api("/api/accounts/users", "POST", {
      username: "observer",
      password: "fixture observer password",
      accessProfileId: "observer",
    });
    cookie = "";
    await api("/api/accounts/sign-in", "POST", {
      username: "observer",
      password: "fixture observer password",
    });
    const observerCookie = cookie;
    const observed: ServicesStatus = await api("/api/services/status");
    assert.deepEqual(Object.keys(observed.services), ["text"]);
    assert.equal(observed.services.text?.state, "healthy");
    assert.equal(observed.services.text?.endpoints[0].endpoint, undefined);
    await profile(false);
    cookie = observerCookie;
    const denied: ServicesStatus = await api("/api/services/status");
    assert.deepEqual(denied.services, {});
    assert.equal(
      healthCalls,
      1,
      "account filtering and cached observations do not introduce additional health requests",
    );
  },
);
