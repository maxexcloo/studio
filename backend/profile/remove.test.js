import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-profile-remove-"));
process.env.STUDIO_DATA_DIR = temporary;
const { removeProfile } = await import("./remove.js");
const { profileStore } = await import("./store.js");
const { readEditableProfile } = await import("./editor.js");
const { userWorkflowsDir } = await import("../custom-workflows.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test("removing a profile keeps its history and refuses a stale hash", () => {
  const id = "image-old-comfyui";
  const text = `${JSON.stringify({ studio: { id, name: "Old", kind: "image" } }, null, 2)}\n`;
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  fs.writeFileSync(path.join(userWorkflowsDir, `${id}.json`), text);
  assert.throws(() => removeProfile(id, { baseHash: "0".repeat(64) }), { status: 409 });

  removeProfile(id, { baseHash: readEditableProfile(id).hash, by: "admin" });
  assert.throws(() => readEditableProfile(id), { status: 404 });
  const store = profileStore({ workflowsDir: userWorkflowsDir });
  assert.equal(store.known(id), true);
  assert.equal(store.version(id, store.meta(id).version).text, text);
});

test("retiring a profile into another makes its id resolve to that one", () => {
  const write = (id, kind) => {
    const text = `${JSON.stringify({ studio: { id, name: id, kind } }, null, 2)}\n`;
    fs.writeFileSync(path.join(userWorkflowsDir, `${id}.json`), text);
  };
  write("image-tier-fast", "image");
  write("image-tier-quality", "image");
  write("video-tier-fast", "video");
  const baseHash = readEditableProfile("image-tier-fast").hash;
  assert.throws(
    () => removeProfile("image-tier-fast", { baseHash, replacement: "video-tier-fast" }),
    {
      status: 400,
    },
  );

  removeProfile("image-tier-fast", { baseHash, replacement: "image-tier-quality" });
  assert.throws(() => readEditableProfile("image-tier-fast"), { status: 404 });
  const store = profileStore({ workflowsDir: userWorkflowsDir });
  assert.equal(store.canonical("custom:image-tier-fast"), "custom:image-tier-quality");
});
