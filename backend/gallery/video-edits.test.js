import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-video-edits-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_MULTI_USER = "1";
const [{ registerVideoEditRoutes }, galleryStore, { RewriteStore }, media, previews] =
  await Promise.all([
    import("./video-edits.js"),
    import("./store.js"),
    import("../domain/store.ts"),
    import("../media-paths.js"),
    import("../video-previews.js"),
  ]);
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
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

const store = new RewriteStore(":memory:");
let edit;
registerVideoEditRoutes({ post: (_route, handler) => (edit = handler) }, { store });
const account = (userId) => ({
  userId,
  authenticated: true,
  role: "user",
  features: { gallery: true },
});
async function call(userId, body) {
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  await edit({ studioAccount: account(userId), body }, res);
  return res;
}

/** A two-second clip with sound in Alice's media folder, made by a job in her Chat. */
function seed() {
  const subfolder = media.mediaSubfolder("alice");
  const file = media.mediaPath("clip.mp4", subfolder);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync(encoder, [
    ...["-hide_banner", "-loglevel", "error", "-y"],
    ...["-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=2"],
    ...["-f", "lavfi", "-i", "sine=frequency=440:duration=2"],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file],
  ]);
  const session = store.createSession("alice", "Waves");
  const parent = store.enqueue("alice", session.id, { prompt: "A wave" }, "animate");
  const { url } = media.mediaUrls("clip.mp4", subfolder);
  galleryStore.setGallery([
    {
      id: url,
      url,
      jobId: parent.id,
      ownerId: "alice",
      type: "video",
      status: "done",
      prompt: "A wave",
      favorite: true,
      createdAt: "2026-11-01T00:00:00.000Z",
    },
  ]);
  return { file, parent, url };
}

/** The clip one of Alice's edits saved. */
async function edited(url, edit) {
  const res = await call("alice", { galleryItemId: url, ...edit });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const { filename, subfolder } = media.mediaParams(res.body.id);
  return { id: res.body.id, clip: await previews.probeVideo(media.mediaFile(filename, subfolder)) };
}
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 150, `got ${actual} ms, not ${expected}`);

test(
  "Each video edit saves the edited clip as a version of the original",
  {
    skip: !available,
  },
  async () => {
    const { file, parent, url } = seed();
    const denied = await call("bob", { galleryItemId: url, kind: "trim", start: 0, end: 500 });
    assert.equal(denied.code, 404);
    const trimmed = await edited(url, { kind: "trim", start: 500, end: 1500 });
    const version = galleryStore.gallery.find((item) => item.id === trimmed.id);
    assert.deepEqual(
      [version.ownerId, version.prompt, version.favorite],
      ["alice", "A wave", undefined],
    );
    const { parentJobId, parentItemId } = store.job("alice", version.jobId);
    assert.deepEqual([parentJobId, parentItemId], [parent.id, url]);
    near(trimmed.clip.durationMs, 1000);
    assert.equal(trimmed.clip.audio, true);
    // The original stays.
    assert.ok(fs.existsSync(file));
    const reversed = (await edited(url, { kind: "reverse" })).clip;
    near(reversed.durationMs, 2000);
    assert.equal(reversed.audio, true);
    // Back and Forth repeats no frame at the turn and is silent, like its download.
    const loop = (await edited(url, { kind: "loop" })).clip;
    near(loop.durationMs, 3958);
    assert.equal(loop.audio, false);
    // Slow Motion takes twice as long at the same rate; Smooth Motion doubles the rate.
    const slow = (await edited(url, { kind: "slow" })).clip;
    near(slow.durationMs, 4000);
    assert.deepEqual([slow.fps, slow.audio], [24, true]);
    assert.equal((await edited(url, { kind: "smooth" })).clip.fps, 48);
  },
);
