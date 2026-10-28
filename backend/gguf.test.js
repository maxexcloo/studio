import assert from "node:assert/strict";
import test from "node:test";

const { withGgufLoaders } = await import("./gguf.js");

/* ------------------------------------------------------------ Profiles and graphs */

test("safetensors-only graphs keep the core loaders", () => {
  const graph = withGgufLoaders({
    1: {
      class_type: "UNETLoader",
      inputs: { unet_name: "flux.safetensors", weight_dtype: "default" },
    },
    2: {
      class_type: "CLIPLoader",
      inputs: { clip_name: "t5.safetensors", type: "flux", device: "default" },
    },
    3: {
      class_type: "CLIPLoader",
      inputs: { clip_name: "qwen3-4b-Q8_0.gguf", type: "lumina2", device: "default" },
    },
  });
  assert.equal(graph[1].class_type, "UNETLoader");
  assert.equal(graph[2].class_type, "CLIPLoader");
  assert.deepEqual(graph[3], {
    class_type: "CLIPLoaderGGUF",
    inputs: { clip_name: "qwen3-4b-Q8_0.gguf", type: "lumina2" },
  });
});
