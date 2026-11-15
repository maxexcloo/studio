import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { readImageMetadata } from "./image-metadata.js";
import { withPngText } from "./png-text.js";

const png = await sharp({ create: { width: 6, height: 4, channels: 3, background: "#c33" } })
  .png()
  .toBuffer();

test("text chunks are written before IEND and read back, Latin-1 and not", async () => {
  let buffer = withPngText(
    png,
    "prompt",
    JSON.stringify({ 1: { class_type: "CLIPTextEncode", inputs: { text: "a fox" } } }),
  );
  buffer = withPngText(buffer, "parameters", "ein Fuchs im Schnee, 狐\nSteps: 4");
  const info = readImageMetadata(buffer);
  assert.equal(info.width, 6);
  assert.equal(info.height, 4);
  assert.equal(info.text.parameters, "ein Fuchs im Schnee, 狐\nSteps: 4");
  assert.match(info.text.prompt, /a fox/);
  // Still a PNG any decoder opens.
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.width, 6);
});

test("writing a keyword again replaces it instead of adding a second", () => {
  const once = withPngText(png, "parameters", "first");
  const twice = withPngText(once, "parameters", "second");
  assert.equal(readImageMetadata(twice).text.parameters, "second");
  assert.equal(twice.toString("latin1").split("parameters").length - 1, 1);
});

test("not a PNG: nothing is written", () => {
  assert.equal(withPngText(Buffer.from("nope"), "parameters", "x"), null);
});
