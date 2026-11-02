import { comfy } from "./comfy.js";

/**
 * ComfyUI keeps its own record of every run, the prompt graph, in /history.
 * Once a run's outputs are in Studio's media it can go. Best effort: a ComfyUI
 * that is gone must never fail the run itself. Resolves to whether ComfyUI took
 * the history entries out.
 */
export async function forgetComfyRun({ promptIds = [] } = {}) {
  const ids = [...new Set(promptIds.filter(Boolean).map(String))];
  if (!ids.length) return true;
  return comfy("/history", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ delete: ids }),
  }).then(
    () => true,
    () => false,
  );
}
