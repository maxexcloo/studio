import fs from "node:fs";
import sharp from "sharp";
import { createModelFiles, createOnnxRunner } from "./onnx.ts";
import type { InferRequest } from "./onnx-worker.ts";

/**
 * SigLIP 2 (base, patch 16, 224 px; Apache-2.0) as ONNX: the full-precision vision encoder, which
 * separates matches clearly better than its int8 copy, and the int8 text encoder, whose size is
 * mostly the 256k-token vocabulary.
 */
export const siglipSource = {
  repository: "onnx-community/siglip2-base-patch16-224-ONNX",
  // renovate: datasource=git-refs depName=https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX
  revision: "ba1f3b0843f24bc5417d38e19c37b287d719b2f4",
  files: {
    tokenizer: "tokenizer.json",
    tokenizerConfig: "tokenizer_config.json",
    vision: "onnx/vision_model.onnx",
    text: "onnx/text_model_int8.onnx",
  },
};
/** Vectors from another model or revision are not comparable, so a new one starts the index again. */
export const siglipVersion = `siglip2-base-patch16-224@${siglipSource.revision.slice(0, 12)}`;
const size = 224;
// SigLIP was trained on text padded to 64 tokens; its pooled output is the last position.
const textLength = 64;

/**
 * The SigLIP 2 image and text encoders on the CPU (onnxruntime-node). The model downloads from
 * Hugging Face into the data folder (`image-search/<revision>/`) the first time it is needed;
 * `fetch` is Studio's Hugging Face fetch (mirror, token and proxy).
 */
export function createSiglip({
  dataDir,
  fetch,
  log = console,
}: {
  dataDir: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  log?: { info(message: string): void };
}) {
  const model = createModelFiles({
    dataDir,
    folder: "image-search",
    revision: siglipSource.revision,
    files: Object.fromEntries(
      Object.values(siglipSource.files).map((name) => [
        name,
        `https://huggingface.co/${siglipSource.repository}/resolve/${siglipSource.revision}/${name}`,
      ]),
    ),
    label: "SigLIP 2 model (about 690 MB)",
    fetch,
    log,
  });
  const runner = createOnnxRunner("image search");
  let tokenizer: Promise<{ encode(value: string): { ids: number[] } }> | null = null;
  async function infer(
    name: string,
    input: Pick<InferRequest, "input" | "type" | "data" | "dims">,
  ) {
    await model.ensureDownloaded();
    const outputs = await runner.run({
      model: model.file(name),
      ...input,
      outputs: ["pooler_output"],
    });
    return unit(outputs.pooler_output);
  }
  const loadTokenizer = () =>
    (tokenizer ||= (async () => {
      await model.ensureDownloaded();
      const { Tokenizer } = await import("@huggingface/tokenizers");
      const read = (name: string) => JSON.parse(fs.readFileSync(model.file(name), "utf8"));
      return new Tokenizer(
        read(siglipSource.files.tokenizer),
        read(siglipSource.files.tokenizerConfig),
      );
    })().catch((error) => {
      tokenizer = null;
      throw error;
    }));

  return {
    /** Why the encoders can't run now ("" when they can or haven't been asked to). */
    unavailable: model.unavailable,
    /** Whether the model is in the data folder, so a search can use it without downloading. */
    downloaded: model.downloaded,
    /** A unit-length image vector; the image is stretched to 224 px square, as SigLIP was trained. */
    async embedImage(bytes: Uint8Array) {
      const { data } = await sharp(bytes)
        .rotate()
        .removeAlpha()
        .toColourspace("srgb")
        .resize(size, size, { fit: "fill", kernel: "linear" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const area = size * size;
      const pixels = new Float32Array(3 * area);
      for (let index = 0; index < area; index += 1)
        for (let channel = 0; channel < 3; channel += 1)
          pixels[channel * area + index] = data[index * 3 + channel] / 127.5 - 1;
      return infer(siglipSource.files.vision, {
        input: "pixel_values",
        type: "float32",
        data: pixels,
        dims: [1, 3, size, size],
      });
    },
    /** A unit-length text vector, from the lowercased text as SigLIP 2 was trained. */
    async embedText(value: string) {
      const ids = (await loadTokenizer()).encode(value.toLowerCase()).ids.slice(0, textLength);
      const padded = new BigInt64Array(textLength);
      ids.forEach((id, index) => (padded[index] = BigInt(id)));
      return infer(siglipSource.files.text, {
        input: "input_ids",
        type: "int64",
        data: padded,
        dims: [1, textLength],
      });
    },
  };
}
export type Siglip = ReturnType<typeof createSiglip>;

function unit(vector: Float32Array) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum) || 1;
  return Float32Array.from(vector, (value) => value / length);
}
