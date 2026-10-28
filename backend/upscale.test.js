import "./fixtures/sample-profiles.js";
import assert from "node:assert/strict";
import test from "node:test";

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

test("the worker's listing decides what is installed", () => {
  const status = upscaleStatus(infoWith(registryListing), "fast");
  assert.equal(status.nodesInstalled, true);
  assert.equal(status.ready, true);
  assert.deepEqual(status.missingModels, []);
  const empty = upscaleStatus(infoWith(), "fast");
  assert.equal(empty.ready, false);
  assert.equal(empty.needsDownload, true);
  assert.deepEqual(empty.missingModels, ["dit", "vae"]);
  assert.equal(
    empty.downloadBytes,
    modelFiles["seedvr2_ema_3b_fp8_e4m3fn.safetensors"].bytes +
      modelFiles["ema_vae_fp16.safetensors"].bytes,
  );
});

test("another tier runs on the weight the worker has rather than demanding a download", () => {
  const high = upscaleStatus(
    infoWith({ dit: ["seedvr2_ema_3b_fp8_e4m3fn.safetensors"], vae: registryListing.vae }),
    "high",
  );
  assert.equal(high.ready, true);
  assert.equal(high.substituting, true);
  assert.equal(high.fallbackFile, "seedvr2_ema_3b_fp8_e4m3fn.safetensors");
});

test("the graph uses the machine's own device and skips block swap without an offload device", () => {
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

test("the terminal install clones the pinned pack and installs its requirements", async () => {
  const { packInstallPlan } = await import("./node-install.js");
  const { nodePack } = await import("./node-packs.js");
  assert.equal(
    packInstallPlan(nodePack("seedvr2")).commands[0].command,
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
