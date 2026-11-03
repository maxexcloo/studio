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

test("removing a profile backs it up, keeps its history and refuses a stale hash", () => {
  const id = "image-old-comfyui";
  const text = `${JSON.stringify({ studio: { id, name: "Old", kind: "image" } }, null, 2)}\n`;
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  fs.writeFileSync(path.join(userWorkflowsDir, `${id}.json`), text);
  assert.throws(() => removeProfile(id, { baseHash: "0".repeat(64) }), { status: 409 });

  const { backup } = removeProfile(id, { baseHash: readEditableProfile(id).hash, by: "admin" });
  assert.throws(() => readEditableProfile(id), { status: 404 });
  assert.equal(fs.readFileSync(path.join(temporary, backup, `${id}.json`), "utf8"), text);
  assert.equal(profileStore({ workflowsDir: userWorkflowsDir }).known(id), true);
});
