import { availableParallelism } from "node:os";
import { parentPort } from "node:worker_threads";
import type { InferenceSession } from "onnxruntime-node";

/**
 * Runs ONNX models for providers/onnx.ts (SigLIP 2, the face check). onnxruntime-node loads and
 * runs a model synchronously on the calling thread, which held Studio's event loop for about a
 * second per image.
 */
export interface InferRequest {
  id: number;
  model: string;
  input: string;
  type: "float32" | "int64";
  data: Float32Array | BigInt64Array;
  dims: number[];
  /** The outputs to send back, by name. */
  outputs: string[];
}

process.env.ORT_DISABLE_TELEMETRY = "1";
const ort = await import("onnxruntime-node");
const sessions = new Map<string, Promise<InferenceSession>>();

function session(model: string) {
  let loading = sessions.get(model);
  if (!loading) {
    // Half the cores, so inference never starves the server or the NAS.
    loading = ort.InferenceSession.create(model, {
      intraOpNumThreads: Math.max(1, Math.floor(availableParallelism() / 2)),
      graphOptimizationLevel: "all",
    });
    loading.catch(() => sessions.delete(model));
    sessions.set(model, loading);
  }
  return loading;
}

parentPort!.on("message", async ({ id, model, input, type, data, dims, outputs }: InferRequest) => {
  try {
    const result = await (await session(model)).run({ [input]: new ort.Tensor(type, data, dims) });
    const sent = Object.fromEntries(
      outputs.map((name) => [name, Float32Array.from(result[name].data as Float32Array)]),
    );
    parentPort!.postMessage(
      { id, outputs: sent },
      Object.values(sent).map((values) => values.buffer),
    );
  } catch (error) {
    parentPort!.postMessage({ id, error: (error as Error).message });
  }
});
