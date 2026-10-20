import fs from "node:fs";
import path from "node:path";
import { comfy, comfyInputDir } from "./comfy.js";

/**
 * ComfyUI keeps its own record of every run: the prompt graph in /history and
 * any image it was handed in its input folder. Once a run's outputs are in
 * Studio's media, or a staged input was only a temporary copy, both can go.
 * Best effort: a ComfyUI that is gone or a file that is locked must never fail
 * the run itself. Resolves to whether ComfyUI took the history entries out.
 */
export async function forgetComfyRun({ promptIds = [], inputNames = [] } = {}) {
  const ids = [...new Set(promptIds.filter(Boolean).map(String))];
  let historyGone = true;
  if (ids.length) {
    historyGone = await comfy("/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: ids })
    }).then(() => true, () => false);
  }
  const inputDir = comfyInputDir();
  if (!inputDir) return historyGone;
  const base = path.resolve(inputDir);
  for (const name of new Set(inputNames.filter(Boolean).map(String))) {
    const file = path.resolve(base, name);
    if (!file.startsWith(`${base}${path.sep}`)) continue;
    try { fs.unlinkSync(file); } catch { /* already gone, or ComfyUI still holds it */ }
  }
  return historyGone;
}
