import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Each test file runs in its own process, so these folders stay here.
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-output-"));
process.env.STUDIO_MEDIA_DIR = outputDir;
process.env.STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "studio-data-"));
const {
  galleryRevisionValue,
  hideGalleryItems,
  makePendingItems,
  pageGallery,
  replaceGalleryJob,
  setGallery,
} = await import("./gallery-store.js");

const url = (filename) =>
  `/comfy/view?${new URLSearchParams({ filename, subfolder: "", type: "media" })}`;

test("completed videos use their encoded dimensions instead of requested aspect or resolution", async (context) => {
  let encoder;
  try {
    encoder = createRequire(import.meta.url)("ffmpeg-static");
  } catch {
    encoder = "ffmpeg";
  }
  try {
    execFileSync(encoder, ["-version"], { stdio: "ignore" });
  } catch {
    context.skip("Video encoder unavailable");
    return;
  }
  const filename = "portrait-video.mp4";
  execFileSync(encoder, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:size=96x160:rate=24",
    "-t",
    "0.25",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    path.join(outputDir, filename),
  ]);
  const body = {
    kind: "video",
    prompt: "A hot-air balloon",
    width: 1280,
    height: 720,
    model: "custom:grok-video-standard",
    modelName: "grok-imagine-video",
    duration: 6,
    resolution: "720p",
    steps: 20,
    cfg: 8,
    sampler: "euler",
    scheduler: "simple",
  };
  setGallery(makePendingItems("actual-video-size", body));
  const [completed] = await replaceGalleryJob(
    "actual-video-size",
    [{ url: url(filename), filename, type: "video" }],
    body,
    new Map(),
  );
  assert.equal(completed.width, 96);
  assert.equal(completed.height, 160);
  assert.equal(completed.settings.duration, 6);
  assert.equal(completed.settings.resolution, "720p");
  for (const field of ["steps", "cfg", "sampler", "scheduler"])
    assert.equal(completed.settings[field], undefined);
  assert.equal(pageGallery({}).items[0].height, 160);
});

test("a video that cannot be probed still completes with its requested dimensions", async () => {
  const filename = "unreadable-video.mp4";
  fs.writeFileSync(path.join(outputDir, filename), "not a video");
  const body = {
    kind: "video",
    prompt: "A heron",
    width: 720,
    height: 1280,
    steps: 8,
    cfg: 1,
    sampler: "euler",
    scheduler: "simple",
  };
  setGallery(makePendingItems("fallback-video-size", body));
  const [completed] = await replaceGalleryJob(
    "fallback-video-size",
    [{ url: url(filename), filename, type: "video" }],
    body,
    new Map(),
  );
  assert.equal(completed.status, "done");
  assert.equal(completed.width, 720);
  assert.equal(completed.height, 1280);
  assert.equal(completed.settings.steps, 8);
});

test("a result keeps the prompt the queue wrote with its model and thinking, not the request", async () => {
  const filename = "written-prompt.png";
  fs.writeFileSync(path.join(outputDir, filename), "png");
  // A queue job's input, as the cloud adapter passes it on.
  const body = {
    kind: "image",
    prompt: "The bird takes flight",
    writing: {
      kind: "animate",
      theme: "action",
      source: "An amber bird",
      prompt: "The bird takes flight",
      model: "ai/text",
      thinking: "A take-off reads best.",
    },
  };
  const [completed] = await replaceGalleryJob(
    "written-prompt",
    [{ url: url(filename), filename, type: "image" }],
    body,
    new Map(),
  );
  assert.equal(completed.prompt, "The bird takes flight");
  assert.deepEqual(completed.writing, {
    kind: "animate",
    model: "ai/text",
    thinking: "A take-off reads best.",
  });
});

test("separate variants keep their requested composer count without retrying the whole group", async () => {
  const body = {
    kind: "image",
    prompt: "a heron",
    count: 1,
    variationCount: 4,
    profileId: "custom:reference",
    createdAt: new Date().toISOString(),
  };
  const pending = makePendingItems("separate-variant", body);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].settings.count, 1);
  assert.equal(pending[0].settings.variationCount, 4);
  setGallery(pending);
  const completed = await replaceGalleryJob(
    "separate-variant",
    [{ url: url("variant.png"), filename: "variant.png", type: "image" }],
    body,
    new Map(),
  );
  assert.equal(completed.length, 1);
  assert.equal(completed[0].settings.count, 1);
  assert.equal(completed[0].settings.variationCount, 4);
});

test("a run that reuses a deleted image's file name still shows when it finishes", async () => {
  // The newest image, studio_00042_.png, exists; a run starts; then that image is deleted.
  fs.writeFileSync(path.join(outputDir, "studio_00042_.png"), "old");
  const old = {
    id: url("studio_00042_.png"),
    url: url("studio_00042_.png"),
    status: "done",
    type: "image",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  };
  const body = {
    kind: "image",
    prompt: "a fox",
    count: 1,
    createdAt: new Date(Date.now() - 5_000).toISOString(),
  };
  const pending = makePendingItems("job-1", body);
  setGallery([...pending, old]);
  fs.unlinkSync(path.join(outputDir, "studio_00042_.png"));
  hideGalleryItems([old]);
  setGallery(pending);
  const since = galleryRevisionValue();

  // ComfyUI saves the run under the freed name.
  fs.writeFileSync(path.join(outputDir, "studio_00042_.png"), "new");
  await replaceGalleryJob(
    "job-1",
    [{ url: url("studio_00042_.png"), filename: "studio_00042_.png", type: "image" }],
    body,
    new Map(),
  );

  assert.ok(galleryRevisionValue() > since);
  assert.deepEqual(
    pageGallery({}).items.map((item) => item.url),
    [url("studio_00042_.png")],
  );
});

test("a finished image is listed at once, before the folder listing catches up", async () => {
  const finished = () => pageGallery({}).items.filter((item) => item.status === "done").length;
  fs.writeFileSync(path.join(outputDir, "older.png"), "x");
  setGallery([
    {
      id: url("older.png"),
      url: url("older.png"),
      status: "done",
      type: "image",
      createdAt: new Date(Date.now() - 100_000).toISOString(),
    },
  ]);
  // Let the cached listing settle, then read it, as a page load does.
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const body = { kind: "image", prompt: "a heron", count: 1, createdAt: new Date().toISOString() };
  setGallery([...makePendingItems("job-2", body), ...pageGallery({}).items]);
  assert.equal(finished(), 1);
  fs.writeFileSync(path.join(outputDir, "fresh.png"), "y");
  await replaceGalleryJob(
    "job-2",
    [{ url: url("fresh.png"), filename: "fresh.png", type: "image" }],
    body,
    new Map(),
  );
  assert.equal(finished(), 2);
  assert.ok(pageGallery({}).items.some((item) => item.url === url("fresh.png")));
});

test("an image shown upscaled is used upscaled, at the original's size", async () => {
  const { loadSharp } = await import("./sharp-loader.js");
  const sharp = await loadSharp();
  if (!sharp) return;
  const { bytesForReference } = await import("./references.js");
  const png = (width, height, r) =>
    sharp({ create: { width, height, channels: 3, background: { r, g: 0, b: 0 } } })
      .png()
      .toBuffer();
  fs.writeFileSync(path.join(outputDir, "ref.png"), await png(64, 48, 10));
  fs.writeFileSync(path.join(outputDir, "ref-up.png"), await png(256, 192, 250));
  const item = {
    id: url("ref.png"),
    url: url("ref.png"),
    outputName: "ref.png",
    status: "done",
    type: "image",
    createdAt: new Date().toISOString(),
    upscaleActive: true,
    upscale: { status: "done", url: url("ref-up.png"), outputName: "ref-up.png" },
  };
  setGallery([item]);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const id = `gallery:${Buffer.from(item.url).toString("base64url")}`;
  const used = await bytesForReference({ headers: {} }, id);
  const meta = await sharp(used.buffer).metadata();
  const { data } = await sharp(used.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([meta.width, meta.height, data[0] > 200], [64, 48, true]);

  setGallery([{ ...item, upscaleActive: false }]);
  const original = await bytesForReference({ headers: {} }, id);
  const { data: originalData } = await sharp(original.buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(originalData[0] < 50);
});

test("Radiance reference settings omit unsupported denoise", async () => {
  const { generationSettings } = await import("./gallery-store.js");
  const reference = {
    kind: "image",
    modelName: "qwen-image.rad",
    startImageId: "reference",
    denoise: 0.7,
  };
  assert.equal(generationSettings(reference).denoise, undefined);
  assert.equal(generationSettings({ ...reference, modelName: "qwen.safetensors" }).denoise, 0.7);
});
