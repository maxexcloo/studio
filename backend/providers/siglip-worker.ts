import { availableParallelism } from "node:os";
import { parentPort } from "node:worker_threads";
import type { InferenceSession } from "onnxruntime-node";

/**
 * Runs the SigLIP 2 encoders for providers/siglip.ts. onnxruntime-node loads and runs a model
 * synchronously on the calling thread, which held Studio's event loop for about a second per image.
 */
export interface InferRequest {
  id: number;
  model: string;
  input: string;
  type: "float32" | "int64";
  data: Float32Array | BigInt64Array;
  dims: number[];
}

process.env.ORT_DISABLE_TELEMETRY = "1";
const ort = await import("onnxruntime-node");
const sessions = new Map<string, Promise<InferenceSession>>();

function session(model: string) {
  let loading = sessions.get(model);
  if (!loading) {
    // Half the cores, so embedding never starves the server or the NAS.
    loading = ort.InferenceSession.create(model, {
      intraOpNumThreads: Math.max(1, Math.floor(availableParallelism() / 2)),
      graphOptimizationLevel: "all",
    });
    loading.catch(() => sessions.delete(model));
    sessions.set(model, loading);
  }
  return loading;
}

parentPort!.on("message", async ({ id, model, input, type, data, dims }: InferRequest) => {
  try {
    const output = await (await session(model)).run({ [input]: new ort.Tensor(type, data, dims) });
    const vector = Float32Array.from(output.pooler_output.data as Float32Array);
    parentPort!.postMessage({ id, vector }, [vector.buffer]);
  } catch (error) {
    parentPort!.postMessage({ id, error: (error as Error).message });
  }
});
