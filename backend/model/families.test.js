import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point the data folder at a scratch tree before the modules read it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-model-types-"));
process.env.STUDIO_DATA_DIR = path.join(scratch, "data");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { classifyModel } = await import("./families.js");

/* ------------------------------------------------------------ recognition */

test("model files are placed by their names", () => {
  assert.equal(
    classifyModel("unet", "remote/flux1-krea-dev.safetensors").family,
    "flux1",
    "FLUX.1 Krea is Flux",
  );
  assert.equal(classifyModel("unet", "remote/z_image_turbo_bf16.safetensors").variant.id, "turbo");
  assert.equal(classifyModel("unet", "remote/z_image_bf16.safetensors").variant.id, "base");
  assert.equal(classifyModel("unet", "remote/krea2_raw_bf16.safetensors").variant.id, "raw");
  assert.equal(
    classifyModel("unet", "remote/wan2.2_t2v_high_noise_14B_fp8.safetensors").family,
    "wan22_14b",
  );
  const unknownCheckpoint = classifyModel("checkpoint", "remote/cyberrealisticPony_v8.safetensors");
  assert.deepEqual([unknownCheckpoint.family, unknownCheckpoint.variant.id], ["sdxl", "pony"]);
});

test("MiniMax-H3-Image's files are the MiniMax H3 Image family, not H3 video", async () => {
  const { refinedFamily } = await import("../family-catalogue.js");
  const found = classifyModel("unet", "minimax_h3_image_pruned_int8_convrot.safetensors");
  assert.equal(
    classifyModel("unet", "minimax_h3_fl2va_pruned_int8_convrot.safetensors").family,
    "minimax_h3",
  );
  assert.deepEqual([found.family, found.variant.id], ["minimax_h3_image", "standard"]);
  assert.equal(
    refinedFamily("minimax_h3", "minimax_h3_image_pruned_bf16.safetensors"),
    "minimax_h3_image",
  );
});

/* ------------------------------------------------------------ profiles */

test("an imported workflow's missing file gets a download only for that exact catalogue file", async () => {
  const { catalogueDownloadsForFile } = await import("../catalogue-downloads.js");
  const [vae] = catalogueDownloadsForFile("flux2-vae.safetensors", "vae");
  assert.deepEqual([vae.id, vae.label, vae.folder], ["vae:flux2:0", "Flux.2 VAE", "vae"]);
  assert.equal(
    catalogueDownloadsForFile("qwen_3_8b_fp8mixed.safetensors", "text_encoders")[0].id,
    "encoder:qwen3_8b:1",
  );
  assert.deepEqual(
    catalogueDownloadsForFile("flux2-vae.safetensors", "text_encoders"),
    [],
    "right name, wrong folder",
  );
  assert.deepEqual(
    catalogueDownloadsForFile("flux/flux2-vae.safetensors", "vae"),
    [],
    "a subfolder path is not where a download lands",
  );
});

/* ------------------------------------------------------------ Sana */

test("Sana is recognised from its own and diffusers-style weights", () => {
  assert.equal(classifyModel("checkpoint", "Sana_Sprint_0.6B_1024px.pth").variant.id, "sprint");
});

test("every node pack is one registry entry", async () => {
  const { nodePacks } = await import("../node-packs.js");
  for (const [id, pack] of Object.entries(nodePacks)) {
    assert.match(pack.repository, /^https:\/\/github\.com\/.+\.git$/, id);
    assert.ok(pack.folder && pack.nodes.length, id);
  }
});

/* ------------------------------------------------------------ Lumina 2, MageFlow, ERNIE */

test("Qwen-Image 2.1 is read from its weights or its name", () => {
  assert.deepEqual(
    [
      classifyModel("unet", "qwenImage21_future_layout.safetensors").family,
      classifyModel("unet", "qwenImage21_future_layout.safetensors").via,
    ],
    ["qwen_image_21", "name"],
  );
});

/* ------------------------------------------------------------ MOSS-Image */

test("a pack inside a bigger repository is cloned beside its folder and only its folder is copied in", async () => {
  const { packInstallPlan } = await import("../node-install.js");
  const { nodePack } = await import("../node-packs.js");
  const plan = packInstallPlan(nodePack("moss_image"));
  const [command] = plan.commands;
  assert.match(
    command.command,
    /git clone https:\/\/github\.com\/OpenMOSS\/MOSS-Image\.git moss-image\.src/,
  );
  assert.match(
    command.command,
    /cp -R "moss-image\.src\/comfyui\/moss-image" "moss-image" && rm -rf "moss-image\.src"/,
  );
  assert.doesNotMatch(command.command, /pip install/);
});
