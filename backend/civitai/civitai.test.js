import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { temporaryFolder } from "../fixtures/temporary.js";

const outputDir = temporaryFolder("studio-media-");
process.env.STUDIO_MEDIA_DIR = outputDir;
process.env.STUDIO_DATA_DIR = temporaryFolder("studio-data-");
const { parametersText, writeCivitaiParameters } = await import("./civitai.js");
const { a1111Recipe, readImageMetadata } = await import("../image-metadata.js");

const body = {
  prompt: "a lighthouse at dusk",
  negative: "blurry",
  model: "sdxl/juggernautXL_v9.safetensors",
  source: "checkpoint",
  steps: 30,
  cfg: 5.5,
  sampler: "dpmpp_2m",
  scheduler: "karras",
  seed: "424242",
  width: 1024,
  height: 1024,
  loras: [{ name: "styles/film-grain.safetensors", strength: 0.65, enabled: true }],
};

test("the text reads the way AUTOMATIC1111 writes it", () => {
  const text = parametersText(body, {
    width: 832,
    height: 1216,
    hashes: { [body.model]: "0123456789" },
  });
  const [prompt, negative, settings] = text.split("\n");
  assert.equal(prompt, "a lighthouse at dusk <lora:film-grain:0.65>");
  assert.equal(negative, "Negative prompt: blurry");
  assert.match(
    settings,
    /^Steps: 30, Sampler: DPM\+\+ 2M, Schedule type: Karras, CFG scale: 5\.5, Seed: 424242, Size: 832x1216, Model hash: 0123456789, Model: juggernautXL_v9/,
  );
  const parsed = a1111Recipe(text);
  assert.equal(parsed.prompt, "a lighthouse at dusk");
  assert.equal(parsed.negative, "blurry");
  assert.equal(parsed.settings.seed, "424242");
  assert.equal(parsed.resources[0].name, "juggernautXL_v9");
});

test("a finished PNG in Studio media always carries it", async () => {
  fs.mkdirSync(path.join(outputDir, "studio"), { recursive: true });
  const file = path.join(outputDir, "studio", "image_00001_.png");
  fs.writeFileSync(
    file,
    await sharp({ create: { width: 8, height: 6, channels: 3, background: "#123" } })
      .png()
      .toBuffer(),
  );
  const outputs = [
    {
      url: `/comfy/view?${new URLSearchParams({ filename: "image_00001_.png", subfolder: "studio", type: "media" })}`,
      filename: "image_00001_.png",
      type: "image",
    },
  ];

  assert.equal(readImageMetadata(fs.readFileSync(file)).text.parameters, undefined);
  assert.equal(await writeCivitaiParameters(outputs, body), 1);
  const info = readImageMetadata(fs.readFileSync(file));
  assert.match(info.text.parameters, /Size: 8x6/, "the file's own size, not the one asked for");
  assert.equal((await sharp(file).metadata()).width, 8);
});
