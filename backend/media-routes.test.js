import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// The real server with Studio media storage: how long a browser may keep each kind of media.
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-media-routes-"));
const media = path.join(dataDir, "media", "studio");
fs.mkdirSync(media, { recursive: true });
await sharp({ create: { width: 900, height: 900, channels: 3, background: "#a37" } })
  .png()
  .toFile(path.join(media, "still.png"));
let encoder;
try {
  encoder = createRequire(import.meta.url)("ffmpeg-static");
} catch {
  encoder = "ffmpeg";
}
let canEncode = true;
try {
  execFileSync(encoder, [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x240:rate=24",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path.join(media, "clip.mp4"),
  ]);
} catch {
  canEncode = false;
}
let server;
let base = "";

test.before(async () => {
  server = fork(path.join(here, "index.js"), [], {
    cwd: path.join(here, ".."),
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      STUDIO_WORKERS: JSON.stringify([
        {
          id: "primary",
          url: "http://127.0.0.1:1",
          capabilities: ["image", "video", "upscale", "models"],
        },
      ]),
      STUDIO_DATA_DIR: dataDir,
      STUDIO_ENV_FILE: path.join(dataDir, ".env"),
      STUDIO_OUTPUT_STORAGE: "studio",
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let errors = "";
  server.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const message = await new Promise((resolve, reject) => {
    server.on("message", resolve);
    server.on("exit", (code) => reject(new Error(`The server exited (${code}): ${errors}`)));
  });
  base = message.url.replace("localhost", "127.0.0.1");
});

test.after(async () => {
  const exited =
    server && server.exitCode === null
      ? new Promise((resolve) => server.once("exit", resolve))
      : null;
  server?.kill("SIGTERM");
  await exited;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// fetch() marks a conditional request no-cache, which a server must answer in full; a browser's revalidation is plain.
const revalidate = (url, etag) =>
  new Promise((resolve, reject) => {
    http
      .get(url, { headers: { "if-none-match": etag } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
      .on("error", reject);
  });
const address = (route, filename, extra = "") =>
  `${base}/comfy/${route}?${new URLSearchParams({ filename, subfolder: "studio", type: "media" })}${extra}`;

test("a Studio media original is cached for good and answers a revalidation with 304", async () => {
  const response = await fetch(address("view", "still.png"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, max-age=31536000, immutable");
  const etag = response.headers.get("etag");
  assert.ok(etag);
  assert.equal(await revalidate(address("view", "still.png"), etag), 304);
  // A copy without its settings is made per request and never kept.
  assert.match(
    (await fetch(address("view", "still.png", "&clean=1"))).headers.get("cache-control"),
    /no-store/,
  );
});

test("a Studio media thumbnail is kept a week, then revalidated by its ETag", async () => {
  const response = await fetch(address("thumb", "still.png", "&v=abc"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(
    response.headers.get("cache-control"),
    "private, max-age=604800, stale-while-revalidate=2592000",
  );
  assert.equal(
    await revalidate(address("thumb", "still.png", "&v=abc"), response.headers.get("etag")),
    304,
  );
});

test("the viewer’s display copy is a WebP of the whole picture, cached like a thumbnail", async () => {
  const response = await fetch(address("thumb", "still.png", "&size=display&v=abc"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(
    response.headers.get("cache-control"),
    "private, max-age=604800, stale-while-revalidate=2592000",
  );
  const display = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  const thumbnail = await sharp(
    Buffer.from(await (await fetch(address("thumb", "still.png", "&v=abc"))).arrayBuffer()),
  ).metadata();
  assert.deepEqual(
    [display.width, display.height],
    [900, 900],
    "under its cap, the original’s own size",
  );
  assert.deepEqual([thumbnail.width, thumbnail.height], [768, 768]);
  assert.equal(
    await revalidate(
      address("thumb", "still.png", "&size=display&v=abc"),
      response.headers.get("etag"),
    ),
    304,
  );
});

test(
  "a video’s thumbnail address gives its poster, so small views show a picture",
  { skip: !canEncode },
  async () => {
    const response = await fetch(address("thumb", "clip.mp4", "&v=abc"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(
      response.headers.get("cache-control"),
      "private, max-age=604800, stale-while-revalidate=2592000",
    );
    const preview = await fetch(address("video-preview", "clip.mp4"));
    assert.equal(preview.status, 200);
    assert.equal(
      preview.headers.get("cache-control"),
      "private, max-age=604800, stale-while-revalidate=2592000",
    );
  },
);
