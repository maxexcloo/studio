import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import sharp from "sharp";
import type { InferRequest } from "./siglip-worker.ts";

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
  let downloadedBytes = 0;
  let failure = { at: -Infinity, reason: "" };
  let tokenizer: Promise<{ encode(value: string): { ids: number[] } }> | null = null;

  const downloaded = () => files.every((name) => fs.existsSync(file(name)));

  async function fetchFile(name: string) {
    if (fs.existsSync(file(name))) return;
    const url = `https://huggingface.co/${siglipSource.repository}/resolve/${siglipSource.revision}/${name}`;
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${name}`);
    fs.mkdirSync(path.dirname(file(name)), { recursive: true });
    const partial = `${file(name)}.part`;
    try {
      await pipeline(
        response.body,
        async function* (chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            downloadedBytes += chunk.byteLength;
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
      downloadedBytes = 0;
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

  // The encoders run in a worker thread (providers/siglip-worker.ts), off the event loop.
  let worker: Worker | null = null;
  const calls = new Map<
    number,
    { resolve(vector: Float32Array): void; reject(error: Error): void }
  >();
  let callCount = 0;
  function startWorker() {
    const started = new Worker(new URL("./siglip-worker.ts", import.meta.url));
    started.on("message", ({ id, vector, error }) => {
      const call = calls.get(id);
      calls.delete(id);
      // Held open only while it has work, so an idle worker never keeps Studio from exiting.
      if (!calls.size) started.unref();
      if (error) call?.reject(new Error(error));
      else call?.resolve(vector);
    });
    const fail = (error: Error) => {
      if (worker === started) worker = null;
      for (const call of calls.values()) call.reject(error);
      calls.clear();
    };
    started.on("error", fail);
    started.on("exit", (code) => fail(new Error(`The image search worker exited (${code}).`)));
    return started;
  }
  async function infer(name: string, input: Omit<InferRequest, "id" | "model">) {
    await ensureDownloaded();
    const id = (callCount += 1);
    const result = new Promise<Float32Array>((resolve, reject) =>
      calls.set(id, { resolve, reject }),
    );
    worker ||= startWorker();
    worker.ref();
    worker.postMessage({ id, model: file(name), ...input }, [input.data.buffer as ArrayBuffer]);
    return unit(await result);
  }
  const loadTokenizer = () =>
    (tokenizer ||= (async () => {
      await ensureDownloaded();
      const { Tokenizer } = await import("@huggingface/tokenizers");
      const read = (name: string) => JSON.parse(fs.readFileSync(file(name), "utf8"));
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
    unavailable() {
      if (download) {
        return `Downloading the SigLIP 2 model (${Math.round(downloadedBytes / 1e6)} of about 690 MB).`;
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
