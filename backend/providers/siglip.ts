import fs from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import type { InferenceSession } from "onnxruntime-node";

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

/** One downloaded copy at a time, in the data folder: `image-search/<revision>/`. */
function modelFolder(dataDir: string) {
  return path.join(dataDir, "image-search", siglipSource.revision);
}

/**
 * The SigLIP 2 image and text encoders on the CPU (onnxruntime-node). The model downloads from
 * Hugging Face into the data folder the first time it is needed; `fetch` is Studio's Hugging Face
 * fetch (mirror, token and proxy).
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
  const folder = modelFolder(dataDir);
  const file = (name: string) => path.join(folder, name);
  const files = Object.values(siglipSource.files);
  let download: Promise<void> | null = null;
  let progress = { done: 0, total: 0 };
  let failure = { at: -Infinity, reason: "" };
  let vision: Promise<InferenceSession> | null = null;
  let text: Promise<{ session: InferenceSession; encode(value: string): number[] }> | null = null;

  const downloaded = () => files.every((name) => fs.existsSync(file(name)));

  async function fetchFile(name: string) {
    if (fs.existsSync(file(name))) return;
    const url = `https://huggingface.co/${siglipSource.repository}/resolve/${siglipSource.revision}/${name}`;
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${name}`);
    const total = Number(response.headers.get("content-length") || 0);
    progress.total += total;
    fs.mkdirSync(path.dirname(file(name)), { recursive: true });
    const partial = `${file(name)}.part`;
    try {
      await pipeline(
        response.body,
        async function* (chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            progress.done += chunk.byteLength;
            yield chunk;
          }
        },
        fs.createWriteStream(partial),
      );
    } catch (error) {
      fs.rmSync(partial, { force: true });
      throw error;
    }
    fs.renameSync(partial, file(name));
  }

  /** Downloads whatever is missing, once; older revisions are removed when it completes. */
  function ensureDownloaded() {
    if (downloaded()) return Promise.resolve();
    download ||= (async () => {
      progress = { done: 0, total: 0 };
      log.info(`[Studio] Image search: downloading ${siglipSource.repository} into ${folder}.`);
      for (const name of files) await fetchFile(name);
      for (const entry of fs.readdirSync(path.dirname(folder)))
        if (entry !== siglipSource.revision)
          fs.rmSync(path.join(path.dirname(folder), entry), { recursive: true, force: true });
    })()
      .catch((error: Error) => {
        failure = { at: Date.now(), reason: error.message };
        throw error;
      })
      .finally(() => (download = null));
    return download;
  }

  async function session(name: string) {
    await ensureDownloaded();
    const ort = await runtime();
    // Half the cores, so embedding never starves the server or the NAS.
    return ort.InferenceSession.create(file(name), {
      intraOpNumThreads: Math.max(1, Math.floor(availableParallelism() / 2)),
      graphOptimizationLevel: "all",
    });
  }
  const retry = <T>(load: () => Promise<T>, clear: () => void) =>
    load().catch((error) => {
      clear();
      throw error;
    });
  const visionSession = () =>
    (vision ||= retry(
      () => session(siglipSource.files.vision),
      () => (vision = null),
    ));
  const textSession = () =>
    (text ||= retry(
      async () => {
        const { Tokenizer } = await import("@huggingface/tokenizers");
        const read = (name: string) => JSON.parse(fs.readFileSync(file(name), "utf8"));
        const loaded = await session(siglipSource.files.text);
        const tokenizer = new Tokenizer(
          read(siglipSource.files.tokenizer),
          read(siglipSource.files.tokenizerConfig),
        );
        return { session: loaded, encode: (value: string) => tokenizer.encode(value).ids };
      },
      () => (text = null),
    ));

  return {
    /** Why the encoders can't run now ("" when they can or haven't been asked to). */
    unavailable() {
      if (download) {
        const share = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
        return `Downloading the SigLIP 2 model (${share}%).`;
      }
      // A failed download waits a minute before the next try.
      if (Date.now() - failure.at < 60_000)
        return `The SigLIP 2 model could not download (${failure.reason}).`;
      return "";
    },
    /** Whether the model is in the data folder, so a search can use it without downloading. */
    downloaded,
    /** A unit-length image vector; the image is stretched to 224 px square, as SigLIP was trained. */
    async embedImage(bytes: Uint8Array) {
      const ort = await runtime();
      const encoder = await visionSession();
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
      const output = await encoder.run({
        pixel_values: new ort.Tensor("float32", pixels, [1, 3, size, size]),
      });
      return unit(output.pooler_output.data as Float32Array);
    },
    /** A unit-length text vector, from the lowercased text as SigLIP 2 was trained. */
    async embedText(value: string) {
      const ort = await runtime();
      const encoder = await textSession();
      const ids = encoder.encode(value.toLowerCase()).slice(0, textLength);
      const padded = new BigInt64Array(textLength);
      ids.forEach((id, index) => (padded[index] = BigInt(id)));
      const output = await encoder.session.run({
        input_ids: new ort.Tensor("int64", padded, [1, textLength]),
      });
      return unit(output.pooler_output.data as Float32Array);
    },
  };
}
export type Siglip = ReturnType<typeof createSiglip>;

/** onnxruntime-node, loaded on first use with its usage telemetry to Microsoft turned off. */
function runtime() {
  process.env.ORT_DISABLE_TELEMETRY = "1";
  return import("onnxruntime-node");
}

function unit(vector: Float32Array) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum) || 1;
  return Float32Array.from(vector, (value) => value / length);
}
