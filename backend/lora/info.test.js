import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-lora-info-"));
process.env.STUDIO_DATA_DIR = path.join(scratch, "data");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { catalogueLoraInfo, familiesFromMetadata, loraCatalogue, triggersFromMetadata } =
  await import("./info.js");

const { loraCompatibility } = await import("./policy.js");

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

test("P-H3-Image's LoRA is a MiniMax H3 adapter", () => {
  const families = familiesFromMetadata({ base_model: "PrunaAI/p-h3-image" });
  assert.deepEqual(families, ["minimax_h3"]);
  assert.equal(loraCompatibility({ families }, { family: "minimax-h3" }), "fits");
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

test("provider and local catalogue metadata retain compatible name-refined I2V models", () => {
  for (const [baseModel, family] of [
    ["Wan Video", "wan22_14b_i2v"],
    ["HunyuanVideo 1.5", "hunyuan15_i2v"],
  ]) {
    const name = "effect.safetensors";
    const info = { families: familiesFromMetadata({ base_model: baseModel }), triggers: [] };
    for (const view of [
      {
        catalogue: {},
        sources: { source: { id: "civitai:1:2", folder: "loras", file: name, baseModel } },
      },
      { catalogue: { [name]: { baseModel } }, sources: {} },
    ]) {
      const enriched = catalogueLoraInfo(name, info, view);
      assert.equal(loraCompatibility(enriched, { family }), "fits", `${baseModel}: ${family}`);
      assert.equal(loraCompatibility(enriched, { family: "sdxl" }), "other");
    }
  }
});

test("a video LoRA is not offered to the image model its family's name refines to", () => {
  const name = "motion.safetensors";
  const info = { families: ["minimax_h3"], triggers: [] };
  const view = { catalogue: { [name]: { baseModel: "MiniMax H3" } }, sources: {} };
  const enriched = catalogueLoraInfo(name, info, view);
  assert.equal(loraCompatibility(enriched, { family: "minimax_h3" }), "fits");
  assert.notEqual(loraCompatibility(enriched, { family: "minimax_h3_image" }), "fits");
});

test("LoRA details come from the catalogue definitions and edits; a left-over lora-catalogue.json is ignored", () => {
  const data = process.env.STUDIO_DATA_DIR;
  fs.mkdirSync(path.join(data, "library"), { recursive: true });
  fs.writeFileSync(
    path.join(data, "lora-catalogue.json"),
    JSON.stringify({ "a.safetensors": { title: "Ignored" } }),
  );
  fs.writeFileSync(
    path.join(data, "library", "catalogue.json"),
    JSON.stringify({
      version: 1,
      layers: { definitions: { "loras/a.safetensors": { title: "Defined", note: "Low" } } },
    }),
  );
  assert.equal(catalogueLoraInfo("a.safetensors", { families: [], triggers: [] }).title, "Defined");
  loraCatalogue().edit("loras/a.safetensors", { title: "Edited" });
  const info = catalogueLoraInfo("a.safetensors", { families: [], triggers: [] });
  assert.deepEqual([info.title, info.note], ["Edited", "Low"], "an edit over the definition");
});
