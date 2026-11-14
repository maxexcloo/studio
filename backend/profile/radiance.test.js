import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-profile-radiance-"));
process.env.STUDIO_DATA_DIR = temporary;
const { addRadianceBackend, radianceConversions, resolveFineTune, withRadianceBackend } =
  await import("./radiance.js");
const { metadataFromJson, userWorkflowsDir } = await import("../custom-workflows.js");
const { readEditableProfile } = await import("./editor.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const id = "image-fine-tune-fast";
const profile = {
  studio: {
    id,
    name: "Fine Tune · Fast · 8 Steps · 1 Reference",
    kind: "image",
    family: "krea2",
    uncensored: true,
    aspectPolicy: "manual",
    aspectRatios: [],
    capabilities: { lora: true, steps: true, startImage: true, imageToImage: true },
    controls: { prompt: { node: "4", input: "text" }, startImage: { node: "6", input: "image" } },
    defaults: { model: "fine-tune.safetensors", width: 864, height: 1152, steps: 8, count: 2 },
    mediaInputs: [{ id: "reference", kind: "image", control: { node: "6", input: "image" } }],
    loraStack: { adapter: "rgthree-power-v1", node: "91", max: 8 },
  },
  graph: {
    1: { class_type: "UNETLoader", inputs: { unet_name: "fine-tune.safetensors" } },
    4: { class_type: "CLIPTextEncode", inputs: { text: "" } },
    6: { class_type: "LoadImage", inputs: { image: "" } },
    9: { class_type: "SaveImage", inputs: { images: ["4", 0] } },
  },
};
fs.mkdirSync(userWorkflowsDir, { recursive: true });
fs.writeFileSync(path.join(userWorkflowsDir, `${id}.json`), JSON.stringify(profile));

test("a converted model joins the profile as a text-only Radiance backend", () => {
  const raw = JSON.parse(withRadianceBackend(profile, "fine-tune-fp8.rad"));
  assert.equal(raw.studio.backend, "radiance");
  assert.equal(raw.studio.uncensored, true);
  const comfyui = metadataFromJson(raw, `${id}.json`, { backend: "comfyui" });
  assert.equal(comfyui.mediaInputs.length, 1);
  const radiance = metadataFromJson(raw, `${id}.json`, { backend: "radiance" });
  assert.equal(radiance.defaults.model, "fine-tune-fp8.rad");
  assert.deepEqual([radiance.defaults.width, radiance.defaults.height], [864, 1152]);
  assert.deepEqual(radiance.mediaInputs, []);
  assert.equal(raw.studio.backends.radiance.graph[1].class_type, "RadianceImageGenerate");
  assert.equal(radiance.loraStack.adapter, "radiance-tags-v1");
  assert.throws(() => withRadianceBackend(raw, "again.rad"), /already has its backends/);
  assert.throws(
    () => withRadianceBackend({ ...profile, studio: { ...profile.studio, family: "flux2" } }, "x"),
    /Only Krea 2/,
  );
});

test("Civitai links resolve to one exact file, preferring fp8", async () => {
  const file = (fileId, fp, primary = false) => ({
    id: fileId,
    name: `fine-tune-${fp}.safetensors`,
    type: "Model",
    primary,
    metadata: { fp },
    hashes: { SHA256: String(fileId).repeat(64).slice(0, 64) },
    sizeKB: 1,
  });
  const version = {
    id: 20,
    modelId: 10,
    model: { name: "Fine Tune", type: "Checkpoint" },
    files: [file(1, "bf16", true), file(2, "fp8")],
  };
  const json = async (pathname) =>
    pathname === "models/10" ? { modelVersions: [{ id: 20 }] } : version;
  const chosen = await resolveFineTune("https://civitai.com/models/10", { json });
  assert.equal(chosen.url, "https://civitai.com/api/download/models/20?fileId=2");
  const exact = await resolveFineTune("https://civitai.com/api/download/models/20?fileId=1", {
    json,
  });
  assert.equal(exact.sha256, "1".repeat(64));
});

test("a finished conversion adds the backend once and clears the worker", async () => {
  const calls = [];
  let conversion = null;
  const applied = [];
  const conversions = radianceConversions({
    pollMs: 60_000,
    resolve: async () => ({ url: "https://civitai.com/x", bytes: 5, sha256: "a".repeat(64) }),
    apply: async (...args) => applied.push(args),
    worker: async (body) => {
      calls.push(body);
      if (body.action === "start")
        conversion = { name: body.name, status: "running", stage: "base", note: body.note };
      if (body.action === "clear") conversion = null;
      return { conversion };
    },
  });
  const started = await conversions.start(id, { url: "link", name: "fine-tune-fp8", by: "Admin" });
  assert.equal(started.conversion.status, "running");
  assert.deepEqual(Object.keys(calls[0].tokens).sort(), ["civitai", "hf"]);
  assert.equal(calls[0].size, 5);
  conversion = { ...conversion, status: "done" };
  const [first, second] = await Promise.all([conversions.state(), conversions.state()]);
  assert.deepEqual(applied, [[id, "fine-tune-fp8.rad", "Admin"]]);
  assert.equal(first.conversion.applied, true);
  assert.equal(second.conversion.applied, true);
  assert.equal(calls.at(-1).action, "clear");
  assert.equal((await conversions.state()).conversion.status, "done");
  await assert.rejects(
    conversions.start("missing-profile", { url: "link", name: "x" }),
    /not found/,
  );
  // The profile file itself is untouched until the worker reports the model installed.
  assert.equal(JSON.parse(readEditableProfile(id).text).studio.backends, undefined);
  await conversions.start(id, { url: "link", name: "fine-tune-fp8", by: "Admin" });
  conversion = null;
  assert.match((await conversions.state()).conversion.error, /worker restarted/);
  const saved = addRadianceBackend(id, "fine-tune-fp8.rad", "Admin");
  assert.deepEqual(Object.keys(JSON.parse(saved.text).studio.backends), ["comfyui", "radiance"]);
});
