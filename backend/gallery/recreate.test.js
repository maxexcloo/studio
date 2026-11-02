import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-recreate-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_MULTI_USER = "1";
const [{ registerRecreateRoute }, galleryStore, { RewriteStore }, { isVersion }] =
  await Promise.all([
    import("./recreate.js"),
    import("./store.js"),
    import("../domain/store.ts"),
    import("../../shared/versions.ts"),
  ]);
after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const store = new RewriteStore(":memory:");
let recreate;
registerRecreateRoute({ post: (_route, handler) => (recreate = handler) }, { store });
function call(userId, body) {
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
  recreate(
    {
      studioAccount: { userId, authenticated: true, role: "user", features: { gallery: true } },
      body,
    },
    res,
  );
  return res;
}

test("Recreate makes an upload the source of its runs, in one Recreate Chat", () => {
  galleryStore.setGallery([
    {
      id: "upload",
      url: "/comfy/view?filename=upload.png",
      ownerId: "alice",
      type: "image",
      status: "done",
      uploaded: true,
      prompt: "",
      suggestedPrompt: "A lighthouse at dusk",
      createdAt: "2026-11-01T00:00:00.000Z",
    },
  ]);
  assert.equal(call("bob", { galleryItemId: "upload" }).code, 404);
  const { sessionId, jobId } = call("alice", { galleryItemId: "upload" }).body;
  const source = store.job("alice", jobId);
  assert.equal(source.sessionId, sessionId);
  assert.equal(source.outputs[0].id, "upload");
  assert.equal(store.session("alice", sessionId).title, "Recreate");
  assert.deepEqual(call("alice", { galleryItemId: "upload" }).body, { ok: true, sessionId, jobId });
  // Any run from it, whatever its model or prompt, is one of its versions.
  const run = { operation: "image", input: { profileId: "flux", prompt: "Something else" } };
  assert.equal(isVersion(run, source), true);
});
