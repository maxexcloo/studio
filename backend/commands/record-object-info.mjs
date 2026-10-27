// Records a ComfyUI /object_info snapshot for the contract tests
// (backend/contract.test.js), so every built-in graph is checked against what a
// real ComfyUI version accepts.
//
//   node backend/commands/record-object-info.mjs [--url http://127.0.0.1:8188]
//   node backend/commands/record-object-info.mjs --from object_info.json --version 0.41.0
//
// Writes backend/fixtures/object_info-comfyui-<version>.json. File lists
// (models, LoRAs, input images) are emptied, so nothing from this computer
// ends up in the repository; the tests fill in names of their own. Tooltips
// and descriptions go too, to keep the file small.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dropKeys = new Set([
  "tooltip",
  "description",
  "display_name",
  "search_aliases",
  "output_tooltips",
  "essentials_category",
  "category",
  "python_module",
]);
const fileLike =
  /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx|png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|flac|json|yaml)$/i;

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !dropKeys.has(key))
      .map(([key, inner]) => [key, strip(inner)]),
  );
}

/** An option list of files on someone's disk: emptied, like a fresh ComfyUI's. */
function isFileList(options) {
  return (
    Array.isArray(options) &&
    options.length > 0 &&
    options.some(
      (option) => typeof option === "string" && (fileLike.test(option) || /[\\/]/.test(option)),
    )
  );
}

function emptyFileLists(spec) {
  if (!Array.isArray(spec)) return spec;
  if (Array.isArray(spec[0]) && isFileList(spec[0])) return [[], ...spec.slice(1)];
  if (spec[0] === "COMBO" && isFileList(spec[1]?.options))
    return ["COMBO", { ...spec[1], options: [] }, ...spec.slice(2)];
  return spec;
}

function sanitizeObjectInfo(info) {
  const out = {};
  for (const [name, node] of Object.entries(info || {})) {
    const clean = strip(node);
    for (const group of ["required", "optional"]) {
      const inputs = clean.input?.[group];
      if (!inputs) continue;
      for (const key of Object.keys(inputs)) inputs[key] = emptyFileLists(inputs[key]);
    }
    out[name] = clean;
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      url: { type: "string", default: "http://127.0.0.1:8188" },
      version: { type: "string", default: "" },
    },
  });
  const comfyUrl = values.url.replace(/\/+$/, "");
  let info;
  let version = values.version;
  if (values.from) {
    info = JSON.parse(fs.readFileSync(values.from, "utf8"));
  } else {
    info = await fetch(`${comfyUrl}/object_info`).then((response) => response.json());
    const stats = await fetch(`${comfyUrl}/system_stats`)
      .then((response) => response.json())
      .catch(() => ({}));
    version ||= stats?.system?.comfyui_version || "";
  }
  if (!version) throw new Error("Pass --version with the ComfyUI version this snapshot is from.");
  const file = path.join(root, "backend", "fixtures", `object_info-comfyui-${version}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(sanitizeObjectInfo(info))}\n`);
  console.log(`Wrote ${path.relative(root, file)} (${Object.keys(info).length} nodes).`);
}
