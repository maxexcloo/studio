import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import express from "express";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-video-previews-test-"));
process.env.STUDIO_DATA_DIR = path.join(dir, "data");
const previews = await import("./video-previews.js");
const { comfyUrl } = await import("./comfy.js");
let encoder;
try {
  encoder = createRequire(import.meta.url)("ffmpeg-static");
} catch {
  encoder = "ffmpeg";
}
let available = true;
try {
  execFileSync(encoder, ["-version"], { stdio: "ignore" });
} catch {
  available = false;
}
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test(
  "real encoder produces a small silent preview, reuses it, and invalidates/removes derivatives",
  { skip: !available },
  async () => {
    const source = path.join(dir, "original.mp4");
    // Leave MP4 metadata at the end: the seekable loopback input must handle this too.
    execFileSync(encoder, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      "10",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-crf",
      "18",
      "-c:a",
      "aac",
      source,
    ]);
    const identity = `${comfyUrl}/view?filename=original.mp4&subfolder=&type=output`;
    const [one, same] = await Promise.all([
      previews.getFileVideoPreview(source, identity),
      previews.getFileVideoPreview(source, identity),
    ]);
    assert.equal(one, same);
    assert.ok(fs.statSync(one).size < fs.statSync(source).size / 2);
    const inspect = (file) => {
      const result = spawnSync(encoder, ["-hide_banner", "-i", file, "-f", "null", "-"], {
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /720x40[46]/, "fits 720 px, the size grid tiles show it at");
      assert.match(result.stderr, /24 fps/);
      assert.doesNotMatch(result.stderr, /Audio:/);
      return result.stderr;
    };
    assert.match(inspect(one), /Duration: 00:00:08\.00/);
    // The still comes from the original, needs no preview, and is cached beside it.
    const poster = await previews.getFileVideoPoster(source, identity);
    assert.match(poster, /\.jpg$/);
    assert.equal(await previews.getFileVideoPoster(source, identity), poster);
    assert.equal(fs.readFileSync(poster).subarray(0, 2).toString("hex"), "ffd8");
    assert.deepEqual(await previews.probeVideo(source), {
      width: 1280,
      height: 720,
      durationMs: 10000,
    });
    const app = express();
    app.get("/preview", (req, res) => previews.sendVideoPreview(req, res, one));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/preview`, {
        headers: { Range: "bytes=0-7" },
      });
      assert.equal(
        response.status,
        206,
        "the dot-directory cache is served, including byte ranges",
      );
      assert.equal(response.headers.get("content-type"), "video/mp4");
      assert.equal((await response.arrayBuffer()).byteLength, 8);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    const now = new Date(Date.now() + 2000);
    fs.utimesSync(source, now, now);
    const changed = await previews.getFileVideoPreview(source, identity);
    assert.notEqual(changed, one);
    // Both previews and the still go: nothing of a deleted video stays in the cache.
    assert.equal(
      await previews.forgetItemVideoPreviews({
        type: "video",
        url: "/comfy/view?filename=original.mp4&type=output",
      }),
      3,
    );
    assert.equal(fs.existsSync(poster), false);
    assert.equal(fs.existsSync(one), false);
    assert.equal(fs.existsSync(changed), false);
  },
);

test(
  "last frame comes from the end of an in-memory video at full size",
  { skip: !available },
  async () => {
    const source = path.join(dir, "extend.mp4");
    // Red then blue, with MP4 metadata at the end: only the closing blue frame may come back.
    execFileSync(encoder, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=red:size=320x180:rate=24:duration=1",
      "-f",
      "lavfi",
      "-i",
      "color=blue:size=320x180:rate=24:duration=1",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1[v]",
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      source,
    ]);
    const frame = await previews.extractFrame(fs.readFileSync(source));
    assert.equal(frame.subarray(1, 4).toString(), "PNG");
    const { default: sharp } = await import("sharp");
    const { data, info } = await sharp(frame).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height], [320, 180]);
    const [red, , blue] = data.subarray(0, 3);
    assert.ok(
      blue > 200 && red < 60,
      `expected the final blue frame, got rgb ${[...data.subarray(0, 3)]}`,
    );
    // A time picks that moment's frame instead.
    const early = await sharp(await previews.extractFrame(fs.readFileSync(source), 500))
      .raw()
      .toBuffer();
    assert.ok(
      early[0] > 200 && early[2] < 60,
      `expected a red frame, got rgb ${[...early.subarray(0, 3)]}`,
    );
  },
);
