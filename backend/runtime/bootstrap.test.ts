import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRuntime } from "./bootstrap.ts";

function configuration(context: { after(fn: () => void): void }, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "studio-runtime-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    join(directory, "workloads.json"),
    JSON.stringify({
      image: {
        kind: "image",
        placements: ["0"],
        studio: { container: "image-worker", placement: "0", url: "http://image:8188" },
        ...overrides,
      },
    }),
  );
  return { STUDIO_CONFIG_DIR: directory, STUDIO_DOCKER_URL: "http://engine:2375" };
}

test("mounted runtime configuration preserves ids and observes by default", async (context) => {
  const environment = configuration(context);
  const calls: string[] = [];
  const runtime = loadRuntime(environment, (async (url) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify(
        String(url).includes("/containers/") ? { State: { Running: true } } : { devices: [] },
      ),
    );
  }) as typeof fetch)!;
  assert.equal(runtime.controller.automaticLifecycle, false);
  (await runtime.controller.acquire("image")).release();
  assert.deepEqual(calls, [
    "http://engine:2375/containers/image-worker/json",
    "http://image:8188/system_stats",
  ]);
});

test("lifecycle control requires both ownership and traffic acknowledgements", (context) => {
  const environment = { ...configuration(context), STUDIO_RUNTIME_AUTOMATIC: "1" };
  assert.throws(() => loadRuntime(environment), /STUDIO_RUNTIME_OWNERSHIP_ACKNOWLEDGED/);
  assert.equal(
    loadRuntime({
      ...environment,
      STUDIO_RUNTIME_OWNERSHIP_ACKNOWLEDGED: "1",
      STUDIO_TEXT_ADMISSION_ACKNOWLEDGED: "1",
    })!.controller.automaticLifecycle,
    true,
  );
});

test("container Running alone does not admit work when worker health fails", async (context) => {
  const runtime = loadRuntime(configuration(context), (async (url) =>
    String(url).includes("/containers/")
      ? new Response(JSON.stringify({ State: { Running: true } }))
      : new Response("starting", { status: 503 })) as typeof fetch)!;
  await assert.rejects(runtime.controller.acquire("image"), /not responding/);
  assert.equal(runtime.controller.status()[0].acceptedOperations, 0);
});

test("health connection timeout leaves work waiting without accepting it", async (context) => {
  const runtime = loadRuntime(configuration(context), (async (url, options) => {
    if (String(url).includes("/containers/"))
      return new Response(JSON.stringify({ State: { Running: true } }));
    assert.ok(options?.signal);
    throw new DOMException("Timed out", "TimeoutError");
  }) as typeof fetch)!;
  await assert.rejects(runtime.controller.acquire("image"), /not responding/);
});

test("configured gateway origin cannot be used as a direct worker", (context) => {
  assert.throws(
    () => loadRuntime({ ...configuration(context), BIFROST_URL: "http://image:8188/gateway" }),
    /directly/,
  );
});

test("unsupported fixed placement fails before contacting Docker", (context) => {
  const environment = configuration(context, {
    studio: { container: "image", placement: "1", url: "http://image:8188" },
  });
  assert.throws(() => loadRuntime(environment), /unsupported/);
});
