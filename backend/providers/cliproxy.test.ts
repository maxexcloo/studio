import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { CliProxyMedia, type CloudRequest } from "./cliproxy.ts";
import { providerMediaWriter } from "./media.ts";
import { studioCloudProfiles } from "./profiles.ts";
import { createCloudQueueAdapter } from "../domain/cloud-adapter.ts";
import { GenerationQueue } from "../domain/queue.ts";
import { RewriteStore } from "../domain/store.ts";
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
  let rejectedVideos = false;
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
      return rejectedVideos
        ? Response.json({ error: "Quota exhausted" }, { status: 429 })
        : Response.json({ request_id: "provider-video-7" });
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
    rejectVideos: (value: boolean) => {
      rejectedVideos = value;
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

test("animating an image sends it as the first frame, shaped by the image, within provider limits", async () => {
  const store = new RewriteStore(":memory:");
  const remote = fixture();
  const node = {
    class_type: "GrokMedia",
    inputs: { model: "grok-imagine-video-1.5", width: 1280, height: 720, resolution: "720p" },
  };
  const cloud = studioCloudProfiles({
    provider: remote.provider,
    workflows: () => [
      {
        profileId: "custom:grok-video",
        name: "Grok Imagine Video 1.5",
        kind: "video",
        graph: { 1: node },
        defaults: { duration: 8 },
        imageModes: { generate: { graph: { 1: node } }, reference: { graph: { 1: node } } },
      },
    ],
    buildProfile: (profile) => profile,
    accountForOwner: () => null,
    mayUseProfile: () => true,
    mayUseFeature: () => true,
    reference: async () => new Uint8Array(),
    composePrompt: (_mode, prompt) => prompt,
  });
  // A portrait JPEG phone photo, stored landscape with an EXIF rotation.
  const photo = await sharp({
    create: { width: 1000, height: 600, channels: 3, background: "blue" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const animate = {
    profileId: "custom:grok-video",
    prompt: "The waves roll in",
    startImage: `data:image/jpeg;base64,${photo.toString("base64")}`,
  };
  const run = async (input: Record<string, unknown>) => {
    const session = store.createSession("");
    const job = store.enqueue("", session.id, input, "animate", undefined, "provider:cliproxyapi");
    const adapter = createCloudQueueAdapter({
      store,
      provider: remote.provider,
      resolve: cloud.resolve,
      saveMedia: async () => ({ url: "/fixture-video" }),
      saveGallery: async () => {},
    });
    await new GenerationQueue(store, adapter).tick();
    return store.job("", job.id)!;
  };
  try {
    const accepted = await run(animate);
    assert.equal(accepted.providerJobId, "provider-video-7");
    const body = remote.calls.find((call) => call.path === "/v1/videos/generations")!.body!;
    assert.equal(body.model, "grok-imagine-video-1.5");
    assert.equal(body.aspect_ratio, "9:16");
    assert.equal(body.duration, 8);
    assert.equal(body.resolution, "720p");
    const frame = String((body.image as { url: string }).url);
    assert.match(frame, /^data:image\/png;base64,/);
    const sent = await sharp(Buffer.from(frame.split(",")[1], "base64")).metadata();
    assert.deepEqual([sent.format, sent.width, sent.height], ["png", 600, 1000]);

    // Limits are refused before anything reaches the provider.
    const submissions = () =>
      remote.calls.filter((call) => call.path === "/v1/videos/generations").length;
    assert.match((await run({ ...animate, duration: 20 })).reason, /between 1 and 15 seconds/);
    assert.match(
      (await run({ ...animate, resolution: "4k" })).reason,
      /supports 480p, 720p, 1080p resolution, not 4k/,
    );
    assert.equal(submissions(), 1);

    // A provider refusal fails the job with its status, which MCP reads to pause cloud video.
    remote.rejectVideos(true);
    const refused = await run(animate);
    assert.equal(refused.status, "failed");
    assert.match(refused.reason, /HTTP 429/);
    const failed = store.failedJobs("provider:cliproxyapi:", new Date(0).toISOString());
    assert.equal(failed.length, 3);
    assert.ok(failed.some((job) => job.id === refused.id));
    assert.deepEqual(
      store.failedJobs("provider:cliproxyapi:", new Date(Date.now() + 1000).toISOString()),
      [],
    );
  } finally {
    store.close();
  }
});
