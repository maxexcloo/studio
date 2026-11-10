import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import type { InferRequest } from "./onnx-worker.ts";

/**
 * Pinned model files a CPU feature downloads into the data folder the first time it is needed:
 * `<dataDir>/<folder>/<revision>/<name>`, one revision at a time. `fetch` is Studio's fetch for
 * the source (Hugging Face's mirror, token and proxy, or plain).
 */
export function createModelFiles({
  dataDir,
  folder,
  revision,
  files,
  label,
  fetch,
  log = console,
}: {
  dataDir: string;
  folder: string;
  revision: string;
  /** Each file's name in the folder and the URL it comes from. */
  files: Record<string, string>;
  /** For messages, such as "SigLIP 2 model (about 690 MB)". */
  label: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  log?: { info(message: string): void };
}) {
  const root = path.join(dataDir, folder);
  const directory = path.join(root, revision);
  const file = (name: string) => path.join(directory, name);
  let download: Promise<void> | null = null;
  let downloadedBytes = 0;
  let failure = { at: -Infinity, reason: "" };
  const downloaded = () => Object.keys(files).every((name) => fs.existsSync(file(name)));

  async function fetchFile(name: string) {
    if (fs.existsSync(file(name))) return;
    const response = await fetch(files[name]);
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${name}`);
    fs.mkdirSync(directory, { recursive: true });
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

  return {
    file,
    downloaded,
    /** Downloads whatever is missing, once; older revisions are removed when it completes. */
    ensureDownloaded() {
      if (downloaded()) return Promise.resolve();
      download ||= (async () => {
        downloadedBytes = 0;
        log.info(`[Studio] Downloading the ${label} into ${directory}.`);
        for (const name of Object.keys(files)) await fetchFile(name);
        for (const entry of fs.readdirSync(root))
          if (entry !== revision)
            fs.rmSync(path.join(root, entry), { recursive: true, force: true });
      })()
        .catch((error: Error) => {
          failure = { at: Date.now(), reason: error.message };
          throw error;
        })
        .finally(() => (download = null));
      return download;
    },
    /** Why the files can't be used now ("" when they can or haven't been asked for). */
    unavailable() {
      if (download)
        return `Downloading the ${label}: ${Math.round(downloadedBytes / 1e6)} MB so far.`;
      // A failed download waits a minute before the next try.
      if (Date.now() - failure.at < 60_000)
        return `The ${label} could not download (${failure.reason}).`;
      return "";
    },
  };
}

/** Runs ONNX models in one worker thread (providers/onnx-worker.ts), off the event loop. */
export function createOnnxRunner(name: string) {
  let worker: Worker | null = null;
  const calls = new Map<
    number,
    { resolve(outputs: Record<string, Float32Array>): void; reject(error: Error): void }
  >();
  let callCount = 0;
  function startWorker() {
    const started = new Worker(new URL("./onnx-worker.ts", import.meta.url));
    started.on("message", ({ id, outputs, error }) => {
      const call = calls.get(id);
      calls.delete(id);
      // Held open only while it has work, so an idle worker never keeps Studio from exiting.
      if (!calls.size) started.unref();
      if (error) call?.reject(new Error(error));
      else call?.resolve(outputs);
    });
    const fail = (error: Error) => {
      if (worker === started) worker = null;
      for (const call of calls.values()) call.reject(error);
      calls.clear();
    };
    started.on("error", fail);
    started.on("exit", (code) => fail(new Error(`The ${name} worker exited (${code}).`)));
    return started;
  }
  return {
    /** The named `outputs` of `model` for one input tensor. */
    run(request: Omit<InferRequest, "id">) {
      const id = (callCount += 1);
      const result = new Promise<Record<string, Float32Array>>((resolve, reject) =>
        calls.set(id, { resolve, reject }),
      );
      worker ||= startWorker();
      worker.ref();
      worker.postMessage({ id, ...request }, [request.data.buffer as ArrayBuffer]);
      return result;
    },
  };
}
