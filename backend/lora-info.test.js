import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-lora-info-"));
process.env.STUDIO_DATA_DIR = path.join(scratch, "data");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { catalogueLoraInfo, familiesFromMetadata, triggersFromMetadata } =
  await import("./lora-info.js");

const t = (shape) => ({ dtype: "F16", shape, data_offsets: [0, 0] });

test("metadata names the base model where the keys cannot", () => {
  assert.deepEqual(familiesFromMetadata({ ss_base_model_version: "sdxl_base_v1-0" }), ["sdxl"]);
  assert.deepEqual(familiesFromMetadata({ "modelspec.architecture": "flux-1-dev/lora" }), [
    "flux1",
  ]);
  assert.deepEqual(familiesFromMetadata({ ss_base_model_version: "sd_v1" }), ["sd15"]);
  assert.deepEqual(familiesFromMetadata({}), []);
});

test("MiniMax H3 compatibility comes from explicit trainer metadata", () => {
  for (const name of ["minimax_h3", "MiniMax-H3", "MiniMax H3"]) {
    assert.deepEqual(familiesFromMetadata({ base_model: name }), ["minimax_h3"]);
  }
  assert.deepEqual(
    familiesFromMetadata({ "modelspec.title": "MiniMax H3 Style" }),
    [],
    "a title alone does not establish compatibility",
  );
});

test("trigger words come from the trainer's note, else the tags on every image", () => {
  assert.deepEqual(triggersFromMetadata({ "modelspec.trigger_phrase": "ohwx person, portrait" }), [
    "ohwx person",
    "portrait",
  ]);
  const frequency = JSON.stringify({ "10_ohwx": { ohwx: 20, "1girl": 20, smile: 4 } });
  assert.deepEqual(
    triggersFromMetadata({
      ss_tag_frequency: frequency,
      ss_dataset_dirs: JSON.stringify({ "10_ohwx": { n_repeats: 10, img_count: 20 } }),
    }),
    ["1girl", "ohwx"],
  );
  assert.deepEqual(triggersFromMetadata({ ss_tag_frequency: "not json" }), []);
});

test("Klein 9B LoKr uses explicit trainer metadata when projection widths are unavailable", () => {
  const header = {
    __metadata__: { ss_base_model_version: "flux2_klein_9b" },
    "diffusion_model.double_blocks.0.img_attn.proj.lokr_w1": t([4, 4]),
    "diffusion_model.double_blocks.0.img_attn.proj.lokr_w2": t([1024, 1024]),
  };
  assert.deepEqual(familiesFromMetadata(header.__metadata__), ["flux2_klein_9b"]);
});

test("MOSS Image Base and SFT metadata share their precise imported model family", () => {
  assert.deepEqual(familiesFromMetadata({ base_model: "MOSS Image Base" }), ["moss_image"]);
  assert.deepEqual(familiesFromMetadata({ base_model: "MOSS Image SFT" }), ["moss_image"]);
  assert.deepEqual(familiesFromMetadata({ base_model: "MOSS Text" }), []);
});

test("Boogu provider metadata identifies its imported family precisely", () => {
  assert.deepEqual(familiesFromMetadata({ base_model: "Boogu" }), ["boogu"]);
});

test("FLUX.3 Klein provider and training metadata do not fall back to FLUX.1", () => {
  assert.deepEqual(familiesFromMetadata({ base_model: "Flux.3 Klein-base" }), ["flux3"]);
  assert.deepEqual(familiesFromMetadata({ ss_base_model_version: "flux3" }), ["flux3"]);
  assert.deepEqual(familiesFromMetadata({ base_model: "Flux.1 Dev" }), ["flux1"]);
});

test("the LoRA catalogue merges data/config (seed) and the data folder (admin), the admin copy winning", () => {
  const data = process.env.STUDIO_DATA_DIR;
  fs.mkdirSync(path.join(data, "config"), { recursive: true });
  fs.writeFileSync(
    path.join(data, "lora-catalogue.json"),
    JSON.stringify({
      "a.safetensors": { title: "By Hand" },
      "b.safetensors": { title: "Only By Hand" },
    }),
  );
  fs.writeFileSync(
    path.join(data, "config", "lora-catalogue.json"),
    JSON.stringify({ "a.safetensors": { title: "Synced" } }),
  );
  assert.equal(catalogueLoraInfo("a.safetensors", { families: [], triggers: [] }).title, "By Hand");
  assert.equal(
    catalogueLoraInfo("b.safetensors", { families: [], triggers: [] }).title,
    "Only By Hand",
  );
  fs.writeFileSync(
    path.join(data, "config", "lora-catalogue.json"),
    JSON.stringify({
      "a.safetensors": { title: "Synced" },
      "c.safetensors": { title: "Only Synced" },
    }),
  );
  assert.equal(
    catalogueLoraInfo("c.safetensors", { families: [], triggers: [] }).title,
    "Only Synced",
    "seed updates still flow",
  );
  // Both files stay as they were; the catalogue holds the merge.
  assert.match(fs.readFileSync(path.join(data, "lora-catalogue.json"), "utf8"), /By Hand/);
  assert.ok(fs.existsSync(path.join(data, "library", "catalogue.json")));
});
