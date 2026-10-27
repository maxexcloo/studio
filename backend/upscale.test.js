import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-seedvr2-"));
process.env.STUDIO_SEEDVR2_MODEL_DIR = dir;
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const { faceDetailSource, modelFiles, upscaleGraph, upscalePlan, upscaleStatus } =
  await import("./upscale.js");

// Shaped like the real /object_info: V3 combos, and offload_device is an optional input.
const combo = (values) => ["COMBO", { options: values }];
const infoWith = ({
  dit = [],
  vae = [],
  devices = ["cuda:0"],
  offloads = ["none", "cpu", "cuda:0"],
} = {}) => ({
  SeedVR2LoadDiTModel: {
    input: {
      required: { model: combo(dit), device: combo(devices) },
      optional: { offload_device: combo(offloads) },
    },
  },
  SeedVR2LoadVAEModel: {
    input: {
      required: { model: combo(vae), device: combo(devices) },
      optional: { offload_device: combo(offloads) },
    },
  },
  SeedVR2VideoUpscaler: { input: { required: {}, optional: { offload_device: combo(offloads) } } },
});
// SeedVR2 2.5+ lists every registry model whether or not it is downloaded.
const registryListing = {
  dit: ["seedvr2_ema_3b_fp8_e4m3fn.safetensors", "seedvr2_ema_7b_fp16.safetensors"],
  vae: ["ema_vae_fp16.safetensors"],
};

/** A sparse file of the exact published size stands in for a real download. */
function placeModel(file) {
  const handle = fs.openSync(path.join(dir, file), "w");
  fs.ftruncateSync(handle, modelFiles[file].bytes);
  fs.closeSync(handle);
}

function clearDir() {
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true });
}

test("registry names in the dropdown do not count as installed", () => {
  clearDir();
  const status = upscaleStatus(infoWith(registryListing), "fast");
  assert.equal(status.nodesInstalled, true);
  assert.equal(status.ready, false);
  assert.equal(status.needsDownload, true);
  assert.deepEqual(status.missingModels, ["dit", "vae"]);
  assert.equal(
    status.downloadBytes,
    modelFiles["seedvr2_ema_3b_fp8_e4m3fn.safetensors"].bytes +
      modelFiles["ema_vae_fp16.safetensors"].bytes,
  );
});

test("complete files on disk make a tier ready; a short copy does not", () => {
  clearDir();
  placeModel("seedvr2_ema_3b_fp8_e4m3fn.safetensors");
  fs.writeFileSync(path.join(dir, "ema_vae_fp16.safetensors"), "truncated");
  assert.equal(upscaleStatus(infoWith(registryListing), "fast").ready, false);
  placeModel("ema_vae_fp16.safetensors");
  assert.equal(upscaleStatus(infoWith(registryListing), "fast").ready, true);
  // Another tier runs on the weight that is here rather than demanding a download.
  const high = upscaleStatus(infoWith(registryListing), "high");
  assert.equal(high.ready, true);
  assert.equal(high.substituting, true);
});

test("a file the node discovered elsewhere counts, and a partial download is reported", () => {
  clearDir();
  fs.writeFileSync(path.join(dir, "seedvr2_ema_7b_fp16.safetensors.part"), Buffer.alloc(1024));
  const status = upscaleStatus(
    infoWith({
      dit: [...registryListing.dit, "my_seedvr2_finetune.safetensors"],
      vae: registryListing.vae,
    }),
    "high",
  );
  assert.equal(status.models.find((model) => model.key === "dit").partialBytes, 1024);
  assert.equal(status.substituting, false);
  assert.equal(status.ready, false, "the VAE is still missing");
});

test("the graph uses the machine's own device and skips block swap without an offload device", () => {
  clearDir();
  placeModel("seedvr2_ema_3b_fp8_e4m3fn.safetensors");
  placeModel("ema_vae_fp16.safetensors");
  // What a Mac really offers: the offload list has no "cpu" at all.
  const mac = upscaleGraph(
    { width: 1024, height: 1024, quality: "fast" },
    infoWith({ ...registryListing, devices: ["mps"], offloads: ["none", "mps"] }),
  ).graph;
  assert.equal(mac["3"].inputs.device, "mps");
  assert.equal(mac["3"].inputs.offload_device, "none");
  assert.equal(mac["4"].inputs.offload_device, "none");
  assert.equal(mac["5"].inputs.offload_device, "none");
  assert.equal(mac["3"].inputs.blocks_to_swap, 0);
  assert.equal(mac["3"].inputs.swap_io_components, false);
  const cuda = upscaleGraph(
    { width: 1024, height: 1024, quality: "fast" },
    infoWith(registryListing),
  ).graph;
  assert.equal(cuda["3"].inputs.device, "cuda:0");
  assert.equal(cuda["3"].inputs.offload_device, "cpu");
  assert.equal(cuda["3"].inputs.blocks_to_swap, 16);
});

test("the terminal install uses ComfyUI's own folder and Python when it can see them", async () => {
  const { packInstallPlan } = await import("./node-install.js");
  const { nodePack } = await import("./node-packs.js");
  const installPlan = (root) => packInstallPlan(nodePack("seedvr2"), root);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-comfy-"));
  fs.mkdirSync(path.join(root, "custom_nodes"));
  fs.mkdirSync(path.join(root, ".venv", "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, ".venv", "bin", "python"), "");
  const fresh = installPlan(root);
  assert.equal(fresh.exact, true);
  assert.equal(fresh.commands.length, 1);
  assert.match(
    fresh.commands[0].command,
    /^cd ".*custom_nodes" && git clone https:\/\/github\.com\/numz\/ComfyUI-SeedVR2_VideoUpscaler\.git && git -C ComfyUI-SeedVR2_VideoUpscaler checkout --detach 5a4bf428f3735cc72ac760d40f372f94dec28422 && ".*\.venv\/bin\/python" -m pip install -r ComfyUI-SeedVR2_VideoUpscaler\/requirements\.txt$/,
  );
  // Cloned but not loading: only the requirements are missing.
  fs.mkdirSync(path.join(root, "custom_nodes", "ComfyUI-SeedVR2_VideoUpscaler"));
  const cloned = installPlan(root);
  assert.equal(cloned.cloned, true);
  assert.equal(cloned.needsGit, false);
  assert.doesNotMatch(cloned.commands[0].command, /git clone/);
  fs.rmSync(root, { recursive: true, force: true });
  // Nothing known: generic, and python3 since many Linux systems have no `python`.
  assert.equal(
    installPlan("").commands[0].command,
    'cd "ComfyUI/custom_nodes" && git clone https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git && git -C ComfyUI-SeedVR2_VideoUpscaler checkout --detach 5a4bf428f3735cc72ac760d40f372f94dec28422 && python3 -m pip install -r ComfyUI-SeedVR2_VideoUpscaler/requirements.txt',
  );
});

test("face detail on an imported workflow's image loads the workflow's model file, not its id", () => {
  const item = {
    model: "custom:flux2-real-dream-image-edit",
    settings: {
      textEncoder: "qwen_3_8b_fp8mixed.safetensors",
      vae: "flux2-vae.safetensors",
      clipType: "wan",
    },
  };
  const workflow = {
    defaults: { model: "real-dream-klein9b-1-fp8.safetensors", clipType: "flux2" },
  };
  const { sourceModel, sourceSettings } = faceDetailSource(item, workflow);
  assert.equal(sourceModel, "real-dream-klein9b-1-fp8.safetensors");
  assert.equal(
    sourceSettings.clipType,
    "flux2",
    "the graph's clip type, not the recorded wan stand-in",
  );
  assert.equal(
    faceDetailSource(
      { ...item, settings: { ...item.settings, modelName: "other.safetensors" } },
      workflow,
    ).sourceModel,
    "other.safetensors",
    "what the run recorded wins",
  );
  assert.deepEqual(
    faceDetailSource({ model: "z_image_turbo.safetensors", settings: { clipType: "lumina2" } }),
    { sourceModel: "z_image_turbo.safetensors", sourceSettings: { clipType: "lumina2" } },
  );

  clearDir();
  placeModel("seedvr2_ema_3b_fp8_e4m3fn.safetensors");
  placeModel("ema_vae_fp16.safetensors");
  const info = {
    ...infoWith(registryListing),
    UNETLoader: {
      input: { required: { unet_name: combo(["real-dream-klein9b-1-fp8.safetensors"]) } },
    },
    UltralyticsDetectorProvider: {
      input: { required: { model_name: combo(["bbox/face_yolov8m.pt"]) } },
    },
  };
  const body = {
    width: 1024,
    height: 1024,
    quality: "fast",
    faceDetail: true,
    prompt: "a face",
    sourceModel,
    sourceSettings,
  };
  const { graph } = upscaleGraph(body, info);
  assert.equal(graph["10"].inputs.unet_name, "real-dream-klein9b-1-fp8.safetensors");
  assert.deepEqual(
    graph["17"].inputs.image,
    ["1", 0],
    "faces are redrawn on the source, at the model's own size",
  );
  assert.deepEqual(graph["2"].inputs.image, ["17", 0], "SeedVR2 upscales the redrawn image");
  assert.deepEqual(graph["9"].inputs.images, ["5", 0]);
  assert.equal(
    graph["17"].inputs.force_inpaint,
    false,
    "a face already past guide_size is left alone, not sampled at full size",
  );
  assert.throws(
    () => upscaleGraph({ ...body, sourceModel: "custom:flux2-real-dream-image-edit" }, info),
    /custom:flux2-real-dream-image-edit, and ComfyUI doesn’t have it/,
  );
});

test("the size menu's 2K/4K reach their long side, whatever the scale", () => {
  // 4K on a model drawn at 2K: doubles. On a square 1024: four times, not capped at 2816.
  assert.deepEqual(
    [upscalePlan({ width: 2048, height: 2048, quality: "high", target: 4096 })].map((plan) => [
      plan.estimatedWidth,
      plan.estimatedHeight,
    ]),
    [[4096, 4096]],
  );
  assert.equal(
    upscalePlan({ width: 1024, height: 1024, quality: "high", target: 4096 }).resolution,
    4096,
  );
  const wide = upscalePlan({ width: 1344, height: 768, quality: "balanced", target: 2048 });
  assert.deepEqual(
    [wide.estimatedWidth, wide.estimatedHeight],
    [2044, 1168],
    "the short side steps by 16",
  );
  // Never smaller than drawn, and no target keeps the effort's own scale.
  assert.equal(
    upscalePlan({ width: 3000, height: 3000, quality: "balanced", target: 2048 }).resolution,
    3008,
  );
  assert.equal(upscalePlan({ width: 1024, height: 1024, quality: "high" }).resolution, 2816);
});

test("video upscale saves restored frames with the original audio and frame rate", () => {
  clearDir();
  placeModel("seedvr2_ema_3b_fp8_e4m3fn.safetensors");
  placeModel("ema_vae_fp16.safetensors");
  const { graph, plan } = upscaleGraph(
    { mediaType: "video", imageName: "clip.mp4", width: 864, height: 480, quality: "fast" },
    infoWith(registryListing),
  );
  assert.equal(graph["1"].class_type, "LoadVideo");
  assert.deepEqual(graph["7"].inputs.audio, ["6", 1]);
  assert.deepEqual(graph["7"].inputs.fps, ["6", 2]);
  assert.equal(graph["9"].class_type, "SaveVideo");
  assert.equal(graph["5"].inputs.batch_size, 5);
  assert.ok(plan.maxResolution >= plan.estimatedWidth);
  assert.ok(plan.maxResolution > plan.resolution);
});

test("balanced and high upscales decode in smaller tiles without changing the requested scale", () => {
  clearDir();
  placeModel("seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors");
  placeModel("ema_vae_fp16.safetensors");
  const info = infoWith({
    dit: ["seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors"],
    vae: ["ema_vae_fp16.safetensors"],
  });
  for (const quality of ["balanced", "high"]) {
    const graph = upscaleGraph(
      { image: "input.png", width: 880, height: 1184, quality },
      info,
    ).graph;
    const vae = Object.values(graph).find((node) => node.class_type === "SeedVR2LoadVAEModel");
    assert.equal(vae.inputs.encode_tile_size, 512);
    assert.equal(vae.inputs.decode_tile_size, 512);
    assert.equal(vae.inputs.decode_tiled, true);
  }
});

test("image and video upscales use wavelet colour correction across quality tiers", () => {
  clearDir();
  placeModel("seedvr2_ema_3b_fp8_e4m3fn.safetensors");
  placeModel("ema_vae_fp16.safetensors");
  for (const mediaType of ["image", "video"]) {
    for (const quality of ["fast", "balanced", "high"]) {
      const { graph } = upscaleGraph(
        { mediaType, quality, width: 640, height: 640 },
        infoWith(registryListing),
      );
      assert.equal(graph["5"].inputs.color_correction, "wavelet", `${mediaType}: ${quality}`);
    }
  }
});
