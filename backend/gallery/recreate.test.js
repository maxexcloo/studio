import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import { openDatabase } from "../persistence/runtime.ts";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-recreate-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_MULTI_USER = "1";
const [{ registerRecreateRoute }, { Store }, { isVersion }] = await Promise.all([
  import("./recreate.js"),
  import("../domain/store.ts"),
  import("../../shared/versions.ts"),
]);
const { setGallery } = await import("../fixtures/gallery.js");
after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const store = new Store(openDatabase(":memory:"));
let recreate;
const described = [];
let caption = "A red fox sitting in snow.";
registerRecreateRoute(
  { post: (_route, handler) => (recreate = handler) },
  {
    store,
    describe: async (item) => {
      described.push(item.id);
      if (!caption) throw new Error("Studio couldn't describe this image.");
      return caption;
    },
  },
);
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
  await recreate(
    {
      studioAccount: { userId, authenticated: true, role: "user", features: { gallery: true } },
      body,
    },
    res,
  );
  return res;
}

test("Recreate makes an upload the source of its runs, in one Recreate session", async () => {
  setGallery([
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
  assert.equal((await call("bob", { galleryItemId: "upload" })).code, 404);
  const { sessionId, jobId, prompt } = (await call("alice", { galleryItemId: "upload" })).body;
  assert.equal(prompt, "A lighthouse at dusk");
  const source = store.job("alice", jobId);
  assert.equal(source.sessionId, sessionId);
  assert.equal(source.outputs[0].id, "upload");
  assert.equal(store.session("alice", sessionId).title, "Recreate");
  assert.deepEqual((await call("alice", { galleryItemId: "upload" })).body, {
    ok: true,
    sessionId,
    jobId,
    prompt,
  });
  // Any run from it, whatever its model or prompt, is one of its versions.
  const run = { operation: "image", input: { profileId: "flux", prompt: "Something else" } };
  assert.equal(isVersion(run, source), true);
});

test("Recreate works from what an item without a prompt shows, captioning it only when needed", async () => {
  const item = (id, extra) => ({
    id,
    url: `/comfy/view?filename=${id}.png`,
    ownerId: "alice",
    type: "image",
    status: "done",
    prompt: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  });
  setGallery([
    item("captioned", {
      uploaded: true,
      prompt: "  ",
      suggestedPrompt: "  ",
      caption: { text: "Fishing boats in pale fog." },
    }),
    item("bare", { uploaded: true }),
    item("unread"),
  ]);
  described.length = 0;
  const captioned = (await call("alice", { galleryItemId: "captioned", savedPromptOnly: true }))
    .body;
  assert.equal(captioned.prompt, "Fishing boats in pale fog.");
  assert.equal(store.job("alice", captioned.jobId).input.prompt, "Fishing boats in pale fog.");
  assert.deepEqual(described, []);
  const savedOnly = await call("alice", { galleryItemId: "bare", savedPromptOnly: true });
  assert.equal(savedOnly.code, 409);
  assert.equal(savedOnly.body.reason, "no-saved-prompt");
  assert.deepEqual(described, []);
  // Bob can't have Alice's image described.
  assert.equal((await call("bob", { galleryItemId: "bare" })).code, 404);
  assert.deepEqual(described, []);
  assert.equal((await call("alice", { galleryItemId: "bare" })).body.prompt, caption);
  assert.deepEqual(described, ["bare"]);
  caption = "";
  const refused = await call("alice", { galleryItemId: "unread" });
  assert.equal(refused.code, 503);
  assert.match(refused.body.error, /couldn't describe/);
});
