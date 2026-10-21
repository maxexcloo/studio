import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-profile-editor-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.COMFY_URL = "http://127.0.0.1:9";
const editor = await import("./profile-editor.js");
const { userWorkflowsDir } = await import("./custom-workflows.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const profile = (overrides = {}) => ({
  heissUi: { id: "image-test", name: "Test Image", kind: "image", family: "flux", controls: { prompt: { node: "2", input: "text" }, steps: { node: "3", input: "steps" } }, ...overrides },
  graph: {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "model.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    "3": { class_type: "KSampler", inputs: { steps: 8, model: ["1", 0], positive: ["2", 0] } }
  }
});
const info = { UNETLoader: { input: { required: { unet_name: [["model.safetensors"]] } } }, CLIPTextEncode: { input: { required: { text: ["STRING"] } } }, KSampler: { input: { required: { steps: ["INT"] } } } };

fs.mkdirSync(userWorkflowsDir, { recursive: true });
fs.writeFileSync(path.join(userWorkflowsDir, "image-test.json"), JSON.stringify(profile(), null, 2));

test("lists Studio's profile files and reads one with its hash", () => {
  const list = editor.listEditableProfiles();
  assert.deepEqual(list.map((item) => [item.id, item.name, item.kind, item.edited]), [["image-test", "Test Image", "image", null]]);
  const read = editor.readEditableProfile("image-test");
  assert.match(read.text, /Test Image/);
  assert.equal(read.hash.length, 64);
  assert.throws(() => editor.readEditableProfile("../accounts"), /not found/);
});

test("checks parse errors, required fields, the id, and controls pointing at real nodes", () => {
  assert.match(editor.validateProfileText("image-test", "{ nope").errors[0], /Not valid JSON/);
  assert.match(editor.validateProfileText("image-test", JSON.stringify(profile({ name: "" }))).errors.join(" "), /name is required/);
  assert.match(editor.validateProfileText("image-test", JSON.stringify(profile({ id: "other" }))).errors.join(" "), /must stay "image-test"/);
  const badControl = editor.validateProfileText("image-test", JSON.stringify(profile({ controls: { prompt: { node: "2", input: "text" }, cfg: { node: "9", input: "cfg" } } })));
  assert.match(badControl.errors.join(" "), /controls.cfg points at node 9/);
  const badInput = editor.validateProfileText("image-test", JSON.stringify(profile({ controls: { prompt: { node: "2", input: "words" } } })));
  assert.match(badInput.errors.join(" "), /input "words"/);
  const fine = editor.validateProfileText("image-test", JSON.stringify(profile()), { info });
  assert.deepEqual([fine.ok, fine.errors, fine.warnings], [true, [], []]);
});

test("the optional nsfw marker must be a boolean", () => {
  assert.match(editor.validateProfileText("image-test", JSON.stringify(profile({ nsfw: "yes" }))).errors.join(" "), /nsfw must be true or false/);
  assert.deepEqual(editor.validateProfileText("image-test", JSON.stringify(profile({ nsfw: true })), { info }).errors, []);
});

test("unknown nodes and files are warnings, not errors", () => {
  const raw = profile();
  raw.graph["1"].inputs.unet_name = "absent.safetensors";
  raw.graph["4"] = { class_type: "RadianceSampler", inputs: {} };
  const checked = editor.validateProfileText("image-test", JSON.stringify(raw), { info });
  assert.equal(checked.ok, true);
  assert.match(checked.warnings.join(" "), /RadianceSampler/);
  assert.match(checked.warnings.join(" "), /absent.safetensors/);
  assert.match(editor.validateProfileText("image-test", JSON.stringify(profile())).warnings[0], /couldn’t be asked/);
});

test("saving backs up the old file, records the edit and refuses a stale base or a bad edit", () => {
  const { hash } = editor.readEditableProfile("image-test");
  assert.throws(() => editor.saveEditableProfile("image-test", "{", { baseHash: hash }), /Not valid JSON/);
  assert.throws(() => editor.saveEditableProfile("image-test", JSON.stringify(profile()), { baseHash: "stale" }), /changed since you opened it/);
  const saved = editor.saveEditableProfile("image-test", JSON.stringify(profile({ name: "Edited Image" }), null, 2), { baseHash: hash, by: "admin-id", info });
  assert.match(saved.text, /Edited Image/);
  assert.notEqual(saved.hash, hash);
  assert.equal(saved.edited.by, "admin-id");
  assert.equal(saved.edited.baseHash, hash);
  assert.equal(editor.listEditableProfiles()[0].edited.by, "admin-id");
  const backups = fs.readdirSync(path.join(temporary, "backups", "profile-edits"));
  assert.equal(backups.length, 1);
  assert.match(fs.readFileSync(path.join(temporary, "backups", "profile-edits", backups[0]), "utf8"), /"Test Image"/);
  // The edits list sits beside the profiles but isn't one.
  assert.equal(editor.listEditableProfiles().length, 1);
});
