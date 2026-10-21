import fs from "node:fs";
import path from "node:path";
import { modelFolders } from "./comfy.js";

/**
 * Hugging Face Diffusers folders in ComfyUI's models/diffusers, for model
 * families whose custom nodes load a whole folder by path (MOSS-Image's own
 * loader). ComfyUI cannot list them, since the node takes free text, so Studio
 * looks itself: only on this computer, only one level deep, and only folders
 * whose transformer/config.json names a class the family expects.
 */

const folderKinds = ["diffusers"];

/** Every models/diffusers folder ComfyUI reads, extra_model_paths.yaml included. */
export function diffusersRoots() {
  return modelFolders("diffusers", folderKinds);
}

function transformerClass(dir) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(dir, "transformer", "config.json"), "utf8"));
    return String(config?._class_name || "");
  } catch {
    return "";
  }
}

/**
 * Folder names (relative to their models/diffusers) whose transformer is one
 * of `classNames`, with everything the loader reads in place.
 */
export function diffusersFolders(classNames = [], roots = diffusersRoots()) {
  const wanted = new Set(classNames);
  const found = [];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = path.join(root, entry.name);
      if (!wanted.has(transformerClass(dir))) continue;
      if (!diffusersFolderComplete(dir)) continue;
      if (!found.includes(entry.name)) found.push(entry.name);
    }
  }
  return found;
}

/** Every weight file a folder's indexes name is there and whole, so a half-finished download never shows as a model. */
export function diffusersFolderComplete(dir) {
  for (const [part, stem] of [["transformer", "diffusion_pytorch_model"], ["text_encoder", "model"], ["vae", "diffusion_pytorch_model"]]) {
    const base = path.join(dir, part);
    if (!fs.existsSync(path.join(base, "config.json"))) return false;
    const index = path.join(base, `${stem}.safetensors.index.json`);
    let files = [`${stem}.safetensors`];
    if (fs.existsSync(index)) {
      try {
        files = [...new Set(Object.values(JSON.parse(fs.readFileSync(index, "utf8")).weight_map || {}))];
      } catch {
        return false;
      }
    }
    if (!files.length || files.some((file) => !fs.existsSync(path.join(base, file)) || fs.existsSync(path.join(base, `${file}.incomplete`)))) return false;
  }
  return fs.existsSync(path.join(dir, "tokenizer"));
}

/**
 * The full path of one listed folder, for the loader's path input; "" when it
 * isn't a folder `diffusersFolders` would list (so a request can never point
 * the loader anywhere else).
 */
export function diffusersFolderPath(name = "", classNames = [], roots = diffusersRoots()) {
  if (!name || /[\\/]/.test(name) || name === "." || name === "..") return "";
  if (!diffusersFolders(classNames, roots).includes(name)) return "";
  for (const root of roots) {
    const dir = path.join(root, name);
    if (wantedClass(dir, classNames)) return dir;
  }
  return "";
}

const wantedClass = (dir, classNames) => classNames.includes(transformerClass(dir));
