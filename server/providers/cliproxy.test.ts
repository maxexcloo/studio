import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { CliProxyMedia, type CloudRequest } from "./cliproxy.ts";
import { providerMediaWriter } from "./media.ts";
import { createCloudQueueAdapter } from "../rewrite/cloud-adapter.ts";
import { GenerationQueue } from "../rewrite/queue.ts";
import { RewriteStore } from "../rewrite/store.ts";
const { writeBytesFileAsync } = await import(new URL("../json-store.js", import.meta.url).href);
const { withPngText } = await import(new URL("../png-text.js", import.meta.url).href);

const image = await sharp({ create: { width: 8, height: 4, channels: 3, background: "white" } })
  .png()
  .toBuffer();
const input: CloudRequest = {
  kind: "image",
  model: "grok-imagine-image-2.0",
  prompt: "A white bird",
  width: 1024,
  height: 512,
  duration: 6,
  resolution: "1k",
  count: 1,
};
function fixture() {
  const calls: { path: string; body?: Record<string, unknown>; authenticated: boolean }[] = [];
  let completed = false;
  let failImages = false;
  let rejectedImages = false;
  const fetchImpl: typeof fetch = async (request, init) => {
    const url = String(request);
    const headers = new Headers(init?.headers);
    const route = new URL(url).pathname;
    calls.push({
      path: route,
      authenticated: headers.has("Authorization"),
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
    });
    if (url.startsWith("https://media.test/"))
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { "content-type": "video/mp4" },
      });
    if (route === "/v1/models")
      return Response.json({ data: [{ id: input.model }, { id: "grok-imagine-video-1.5" }] });
    if (route === "/v1/images/generations" || route === "/v1/images/edits") {
      if (failImages) throw new TypeError("Fixture connection lost after submission.");
      if (rejectedImages) return Response.json({ error: "Rate limited" }, { status: 429 });
      return Response.json({ data: [{ b64_json: image.toString("base64") }] });
    }
    if (route === "/v1/videos/generations")
      return Response.json({ request_id: "provider-video-7" });
    if (route === "/v1/videos/provider-video-7")
      return Response.json(
        completed
          ? { status: "completed", video: { url: "https://media.test/video.mp4" } }
          : { status: "pending" },
      );
    throw new Error(`Unexpected fixture endpoint ${route}`);
  };
  return {
    calls,
    provider: new CliProxyMedia("https://proxy.test", "fixture-value", fetchImpl),
    complete: () => {
      completed = true;
    },
    failImages: () => {
      failImages = true;
    },
    recoverImages: () => {
      failImages = false;
    },
    rejectImages: (value: boolean) => {
      rejectedImages = value;
    },
  };
}

test("direct image refinement uses advertised provider model and saves real owned media", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-provider-"));
  const store = new RewriteStore(path.join(directory, "studio.sqlite"));
  const remote = fixture();
  const published: string[] = [];
  try {
    const session = store.createSession("alice");
    const job = store.enqueue("alice", session.id, {}, "refine", undefined, "provider:cliproxyapi");
    const adapter = createCloudQueueAdapter({
      store,
      provider: remote.provider,
      resolve: async () => ({
        ...input,
        reference: image,
        model: await remote.provider.select("image", input.model),
      }),
      saveMedia: providerMediaWriter(
        path.join(directory, "media"),
        (owner) => owner,
        writeBytesFileAsync,
        withPngText,
      ),
      saveGallery: async (_job, outputs) => {
        published.push(String(outputs[0].url));
      },
    });
    await new GenerationQueue(store, adapter).tick();
    const completed = store.job("alice", job.id)!;
    assert.equal(completed.status, "completed");
    assert.equal(completed.outputs[0].providerModel, input.model);
    assert.equal(completed.outputs[0].width, 8);
    assert.equal(published.length, 1);
    assert.deepEqual(
      await sharp(
        readFileSync(path.join(directory, "media", "alice", String(completed.outputs[0].filename))),
      )
        .raw()
        .toBuffer(),
      await sharp(image).raw().toBuffer(),
    );
    const request = remote.calls.find((call) => call.path === "/v1/images/edits")!;
    assert.equal(request.body?.aspect_ratio, "2:1");
    assert.equal(request.body?.size, undefined);
    assert.equal((request.body?.image as { type: string }).type, "image_url");
    assert.equal(store.providerRecord("bob", job.id), undefined);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("confirmed provider refusal can be retried with a distinct durable generation ID", async () => {
  const store = new RewriteStore(":memory:");
  const remote = fixture();
  remote.rejectImages(true);
  try {
    const session = store.createSession("alice");
    const job = store.enqueue("alice", session.id, {}, "image", undefined, "provider:cliproxyapi");
    const adapter = createCloudQueueAdapter({
      store,
      provider: remote.provider,
      resolve: async () => input,
      saveMedia: async () => ({ url: "/fixture-image" }),
      saveGallery: async () => {},
    });
    const queue = new GenerationQueue(store, adapter);
    await queue.tick();
    assert.equal(store.job("alice", job.id)?.status, "failed");
    const retry = queue.retry("alice", job.id)!;
    assert.notEqual(retry.id, job.id);
    remote.rejectImages(false);
    await queue.tick();
    assert.equal(store.job("alice", retry.id)?.status, "completed");
  } finally {
    store.close();
  }
});

test("async video resumes its persisted provider ID after restart without another POST", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-provider-"));
  const filename = path.join(directory, "studio.sqlite");
  let store = new RewriteStore(filename);
  const remote = fixture();
  const options = () => ({
    store,
    provider: remote.provider,
    resolve: async () => ({
      ...input,
      kind: "video" as const,
      model: await remote.provider.select("video", "grok-imagine-video-1.5"),
      resolution: "720p",
    }),
    saveMedia: providerMediaWriter(
      path.join(directory, "media"),
      (owner: string) => owner,
      writeBytesFileAsync,
      withPngText,
    ),
    saveGallery: async () => {},
  });
  try {
    const session = store.createSession("alice");
    const job = store.enqueue(
      "alice",
      session.id,
      {},
      "animate",
      undefined,
      "provider:cliproxyapi",
    );
    await new GenerationQueue(store, createCloudQueueAdapter(options())).tick();
    assert.equal(store.job("alice", job.id)?.providerJobId, "provider-video-7");
    store.close();
    store = new RewriteStore(filename);
    remote.complete();
    await new GenerationQueue(store, createCloudQueueAdapter(options())).tick();
    assert.equal(store.job("alice", job.id)?.status, "completed");
    assert.equal(remote.calls.filter((call) => call.path === "/v1/videos/generations").length, 1);
    assert.equal(remote.calls.find((call) => call.path === "/video.mp4")?.authenticated, false);
    assert.deepEqual(
      readFileSync(
        path.join(
          directory,
          "media",
          "alice",
          String(store.job("alice", job.id)!.outputs[0].filename),
        ),
      ),
      Buffer.from([1, 2, 3, 4]),
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("lost synchronous response is recovered without resubmit and only its owner may cancel", async () => {
  const store = new RewriteStore(":memory:");
  const remote = fixture();
  remote.failImages();
  try {
    const session = store.createSession("alice");
    const job = store.enqueue("alice", session.id, {}, "image", undefined, "provider:cliproxyapi");
    const options = {
      store,
      provider: remote.provider,
      resolve: async () => input,
      saveMedia: async () => ({ url: "/unreached" }),
      saveGallery: async () => {},
    };
    await new GenerationQueue(store, createCloudQueueAdapter(options)).tick();
    const restarted = new GenerationQueue(store, createCloudQueueAdapter(options));
    await restarted.tick();
    assert.equal(remote.calls.filter((call) => call.path === "/v1/images/generations").length, 1);
    remote.recoverImages();
    const independent = store.enqueue(
      "alice",
      session.id,
      {},
      "image",
      undefined,
      "provider:cliproxyapi",
    );
    assert.notEqual(independent.resource, job.resource);
    await restarted.tick();
    assert.equal(store.job("alice", independent.id)?.status, "completed");
    assert.equal(remote.calls.filter((call) => call.path === "/v1/images/generations").length, 2);
    assert.equal(await restarted.cancel("bob", job.id), undefined);
    await restarted.cancel("alice", job.id);
    await restarted.tick();
    assert.equal(store.job("alice", job.id)?.status, "cancelled");
  } finally {
    store.close();
  }
});
