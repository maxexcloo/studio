import "./fixtures/sample-profiles.js";
import "./fixtures/local-worker.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  composeWorkflowPrompt,
  customWorkflowGraph,
  saveIntoStudioFolder,
  uploadReferenceImage,
} from "./graphs.js";

test("workflow prompt policy remains separate from the user edit", () => {
  const composed = composeWorkflowPrompt(
    {
      promptComposition: {
        prefix: "Edit: ",
        suffix: "Keep everything else the same.",
        policy: "preserve-v1",
        version: 1,
      },
    },
    "Remove the hat",
  );
  assert.equal(composed, "Edit: Remove the hat\n\nKeep everything else the same.");
});

test("bundled Flux edit graph binds its reference, prompt policy, and rgthree LoRAs", async () => {
  const graph = await customWorkflowGraph({
    workflow: "custom:flux2-real-dream-image-edit",
    prompt: "Remove the hat",
    width: 1216,
    height: 1536,
    steps: 2,
    cfg: 1,
    denoise: 1,
    sampler: "euler",
    scheduler: "simple",
    seed: 42,
    referenceAssets: [{ slot: "reference", assetId: "asset-1", comfyName: "staged-reference.png" }],
    loras: [{ name: "style.safetensors", enabled: true, strength: 0.7 }],
  });
  assert.equal(graph["369"].inputs.image, "staged-reference.png");
  assert.match(
    graph["372"].inputs.prompt,
    /^Edit: Remove the hat\n\nKeep the rest of the image exactly the same:/,
  );
  assert.equal(graph["374"].inputs.lora_01, "style.safetensors");
  assert.equal(graph["374"].inputs.strength_01, 0.7);
  assert.equal(graph["374"].inputs.lora_02, "None");
});

test("a single-user run from an imported workflow saves where the workflow says; saveIntoStudioFolder moves it", async () => {
  const request = {
    workflow: "custom:flux2-real-dream-image-edit",
    prompt: "Remove the hat",
    width: 1024,
    height: 1024,
    steps: 2,
    cfg: 1,
    seed: 42,
  };
  assert.equal((await customWorkflowGraph(request))["375"].inputs.filename_prefix, "Flux2_dev");

  const graph = saveIntoStudioFolder({
    1: {
      class_type: "SaveImage",
      inputs: { filename_prefix: "%date:yyyy-MM-dd%/renders/portrait" },
    },
    2: { class_type: "VHS_VideoCombine", inputs: { filename_prefix: ["9", 0] } },
    3: { class_type: "SaveAnimatedWEBP", inputs: { filename_prefix: "../../elsewhere/" } },
    4: { class_type: "KSampler", inputs: { seed: 1 } },
  });
  assert.equal(graph[1].inputs.filename_prefix, "studio/portrait");
  assert.equal(
    graph[2].inputs.filename_prefix,
    "studio/output",
    "a prefix fed by another node becomes a plain one",
  );
  assert.equal(graph[3].inputs.filename_prefix, "studio/elsewhere");
  assert.equal("filename_prefix" in graph[4].inputs, false);
});

test("legacy start images resize before upload and register their temporary copy", async (t) => {
  const { default: sharp } = await import("sharp");
  const buffer = await sharp({
    create: { width: 3000, height: 4000, channels: 3, background: "#445566" },
  })
    .png()
    .toBuffer();
  const url = `data:image/png;base64,${buffer.toString("base64")}`;
  const uploads = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const file = init.body.get("image");
    uploads.push(Buffer.from(await file.arrayBuffer()));
    return new Response(JSON.stringify({ name: file.name }), {
      headers: { "content-type": "application/json" },
    });
  });
  const body = { family: "sdxl", width: 1024, height: 1024 };
  const name = await uploadReferenceImage(url, body);
  const meta = await sharp(uploads[0]).metadata();
  assert.ok(meta.width * meta.height <= 1024 ** 2);
  assert.equal(meta.width % 8, 0);
  assert.deepEqual([body.width, body.height], [meta.width, meta.height]);
  assert.deepEqual(body.requestedSize, { width: 1024, height: 1024 });
  assert.deepEqual(body.temporaryInputNames, [name]);
  assert.deepEqual(body.stagedInputNames, [name]);
  await uploadReferenceImage(url, { width: 1024, height: 1024, autoResizeInputs: false });
  assert.deepEqual(uploads[1], buffer);
});

test("account image runs and their upscales save into the owner's folder", async () => {
  const { accountOutputSubfolder } = await import("./account-ownership.js");
  const graph = saveIntoStudioFolder(
    {
      1: { class_type: "SaveImage", inputs: { filename_prefix: "studio/upscale" } },
      2: { class_type: "SaveImage", inputs: { filename_prefix: "image" } },
    },
    "account-a",
  );
  assert.equal(graph[1].inputs.filename_prefix, `${accountOutputSubfolder("account-a")}/upscale`);
  assert.equal(graph[2].inputs.filename_prefix, `${accountOutputSubfolder("account-a")}/image`);
});

test("a profile's graph inpaints the crop at its working size, stitches it back and can decode in tiles", async () => {
  const graph = await customWorkflowGraph({
    workflow: "custom:flux2-real-dream-image-edit",
    prompt: "Remove the hat",
    width: 1216,
    height: 1536,
    denoise: 1,
    seed: 42,
    referenceAssets: [{ slot: "reference", assetId: "asset-1", comfyName: "original.png" }],
    inpaint: {
      original: "original.png",
      crop: "crop.png",
      mask: "mask.png",
      composite: "stitch.png",
      box: { x: 96, y: 160, width: 512, height: 640 },
      work: { width: 912, height: 1136 },
      strength: 0.8,
    },
    tiledDecode: true,
  });
  const linked = (value) => graph[value[0]];
  assert.equal(graph["369"].inputs.image, "crop.png");
  assert.deepEqual([graph["366"].inputs.width, graph["366"].inputs.height], [912, 1136]);
  const masked = linked(graph["373"].inputs.latent_image);
  assert.equal(masked.class_type, "SetLatentNoiseMask");
  assert.equal(linked(masked.inputs.mask).inputs.image, "mask.png");
  assert.equal(graph["373"].inputs.denoise, 0.8);
  const stitch = linked(graph["375"].inputs.images);
  assert.equal(stitch.class_type, "ImageCompositeMasked");
  assert.deepEqual([stitch.inputs.x, stitch.inputs.y], [96, 160]);
  assert.equal(linked(stitch.inputs.destination).inputs.image, "original.png");
  assert.equal(linked(stitch.inputs.mask).inputs.image, "stitch.png");
  assert.equal(linked(linked(stitch.inputs.source).inputs.image).class_type, "VAEDecodeTiled");
});
