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

test(
  "Trim and Reverse save the edited clip, with its sound, as a version of the original",
  {
    skip: !available,
  },
  async () => {
    const { file, parent, url } = seed();
    assert.equal(
      (await call("bob", { galleryItemId: url, kind: "trim", start: 0, end: 500 })).code,
      404,
    );
    const res = await call("alice", { galleryItemId: url, kind: "trim", start: 500, end: 1500 });
    assert.equal(res.code, 201, JSON.stringify(res.body));
    const version = galleryStore.gallery.find((item) => item.id === res.body.id);
    assert.equal(version.ownerId, "alice");
    assert.equal(version.prompt, "A wave");
    assert.equal(version.favorite, undefined);
    const { parentJobId, parentItemId } = store.job("alice", version.jobId);
    assert.deepEqual([parentJobId, parentItemId], [parent.id, url]);
    const params = media.mediaParams(version.url);
    const clip = await previews.probeVideo(media.mediaFile(params.filename, params.subfolder));
    assert.ok(Math.abs(clip.durationMs - 1000) < 120, `got ${clip.durationMs} ms`);
    assert.equal(clip.audio, true);
    // The original stays.
    assert.ok(fs.existsSync(file));
    // Reversed, it keeps its length and sound.
    const reversed = await call("alice", { galleryItemId: url, kind: "reverse" });
    assert.equal(reversed.code, 201, JSON.stringify(reversed.body));
    const backwards = await previews.probeVideo(
      media.mediaFile(media.mediaParams(reversed.body.id).filename, params.subfolder),
    );
    assert.ok(Math.abs(backwards.durationMs - 2000) < 120, `got ${backwards.durationMs} ms`);
    assert.equal(backwards.audio, true);
  },
);
