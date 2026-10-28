import { optionsFor } from "./comfy.js";

/**
 * GGUF model files, the way ComfyUI-GGUF (city96) loads them: in a graph, a
 * core loader handed a .gguf file becomes its ComfyUI-GGUF twin.
 */

export const isGguf = (name = "") => /\.gguf$/i.test(String(name));

/* ------------------------------------------------------------ Model lists */

/** GGUF text encoders CLIPLoaderGGUF lists (it lists the safetensors ones too; CLIPLoader has those). */
export function ggufEncoderNames(info) {
  return optionsFor(info, "CLIPLoaderGGUF", "clip_name").filter(isGguf);
}

/* ------------------------------------------------------------ Graph */

// Each core loader's ComfyUI-GGUF twin and the inputs the twin does not take.
const ggufLoaders = {
  UNETLoader: { node: "UnetLoaderGGUF", files: ["unet_name"], drop: ["weight_dtype"] },
  CLIPLoader: { node: "CLIPLoaderGGUF", files: ["clip_name"], drop: ["device"] },
  DualCLIPLoader: {
    node: "DualCLIPLoaderGGUF",
    files: ["clip_name1", "clip_name2"],
    drop: ["device"],
  },
  TripleCLIPLoader: {
    node: "TripleCLIPLoaderGGUF",
    files: ["clip_name1", "clip_name2", "clip_name3"],
    drop: [],
  },
  QuadrupleCLIPLoader: {
    node: "QuadrupleCLIPLoaderGGUF",
    files: ["clip_name1", "clip_name2", "clip_name3", "clip_name4"],
    drop: [],
  },
};

/**
 * Swaps every core loader that was handed a .gguf file for its ComfyUI-GGUF
 * twin (whose CLIP loaders also read safetensors, so mixed slots work). Other
 * nodes are left as they are.
 */
export function withGgufLoaders(graph) {
  for (const node of Object.values(graph || {})) {
    const twin = ggufLoaders[node?.class_type];
    if (!twin || !twin.files.some((key) => isGguf(node.inputs?.[key]))) continue;
    node.class_type = twin.node;
    for (const key of twin.drop) delete node.inputs[key];
  }
  return graph;
}
