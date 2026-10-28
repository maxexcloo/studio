import {
  backendUrl,
  currentComfyBackend,
  isDefaultBackend,
  noteWorkerReachable,
} from "./comfy-backends.js";
import { defaultWorker, onWorkersChanged } from "./workers.js";
import { listensBeyondThisComputer } from "./client-trust.js";
import { noteComfyState } from "./crash-log.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mediaFile, mediaType } from "./media-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, "..");
// A live binding: importers see the new address as soon as the workers change.
// It is the default worker's (workers.js), or "" with no workers at all.
export let comfyUrl = defaultWorker()?.url || "";
onWorkersChanged(() => {
  comfyUrl = defaultWorker()?.url || "";
});

export const host = process.env.HOST || "127.0.0.1";
export const networkListening = listensBeyondThisComputer(host);

/** The port asked for (PORT, else 8787). */
const requestedPort = Number(process.env.PORT || 8787);
// A live binding: PORT=0 (tests) listens on whichever port the system gives.
export let port = requestedPort;
export function setListeningPort(value) {
  port = Number(value) || requestedPort;
  return port;
}
/**
 * A subfolder with a dot folder anywhere in it: the gallery's trash
 * (.studio-trash) and anything else kept out of sight. Never served, whether
 * from Studio media or through ComfyUI.
 */
export function inDotFolder(subfolder = "") {
  // A query string can name it twice; every value counts.
  return [].concat(subfolder ?? "").some((value) =>
    String(value || "")
      .split(/[\\/]/)
      .some((part) => part.startsWith(".")),
  );
}
/** What an output can be: images, videos and sound. Anything else is never served. */
export const outputMediaPattern =
  /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|mp4|webm|mov|mkv|m4v|flac|mp3|wav|ogg|opus|m4a|aac)$/i;

/** The file behind an output URL's parts when it is Studio media; null otherwise. */
export function localOutputFile(filename, subfolder = "", type = "output") {
  return type === mediaType ? mediaFile(String(filename || ""), String(subfolder || "")) : null;
}

/** Fake models and placeholder generations when ComfyUI is unreachable. A dev opt-in for agent and UI testing without a GPU. */
export const demoMode = process.env.STUDIO_DEMO === "1";

export function noteComfyReachable() {
  noteWorkerReachable(currentComfyBackend(), true);
  if (isDefaultBackend()) noteComfyState(true);
}

/** Whether an error is a check of ours running out of time, not ComfyUI refusing or dropping it. */
export function isComfyTimeout(error) {
  return error?.name === "AbortError" || error?.name === "TimeoutError";
}
/**
 * Call with what a fetch to ComfyUI threw. A canceled request says nothing about ComfyUI, and a timed-out
 * one reads as busy: a busy ComfyUI takes the connection and answers late while its runs carry on.
 */
export function noteComfyFetchError(error) {
  if (error?.name === "AbortError") return;
  if (!isComfyTimeout(error)) noteComfyState(false, error);
}

/**
 * How long one request to ComfyUI may take before it counts as unanswered.
 * Uploads and file reads move whole images or videos; everything else is a
 * small JSON answer, and a ComfyUI that takes a minute for one is hung.
 */
function comfyTimeoutFor(pathname = "") {
  if (/^\/(upload\/|view\b)/.test(pathname)) return 5 * 60_000;
  if (/^\/object_info\b/.test(pathname)) return 2 * 60_000;
  return 60_000;
}

/**
 * One request to ComfyUI. `timeout` (ms) overrides the default for the path;
 * a caller's own `signal` still cancels it early. A failed answer throws with
 * `status` and the untouched `raw` text next to the friendly message.
 */
export const activeComfyUrl = () => backendUrl();

// Whether ComfyUI's last answer came through (a dropped read is retried only then).
let comfyAnswering = false;

export async function comfy(pathname, options = {}) {
  const { timeout, ...init } = options;
  const limit = AbortSignal.timeout(
    Number(timeout) > 0 ? Number(timeout) : comfyTimeoutFor(pathname),
  );
  init.signal = init.signal ? AbortSignal.any([init.signal, limit]) : limit;
  let response;
  try {
    try {
      response = await fetch(`${activeComfyUrl()}${pathname}`, init);
    } catch (error) {
      // A dropped connection ("fetch failed") on a read is tried once more before ComfyUI counts as gone:
      // the link to a remote worker blips, and one lost GET shouldn't fail a run or a chat's request.
      // Only while it was answering: a ComfyUI already down fails at once, as before.
      const method = String(init.method || "GET").toUpperCase();
      if (
        !comfyAnswering ||
        method !== "GET" ||
        init.signal.aborted ||
        isComfyTimeout(error) ||
        error?.noWorker ||
        error?.name !== "TypeError"
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      response = await fetch(`${activeComfyUrl()}${pathname}`, init);
    }
  } catch (error) {
    comfyAnswering = false;
    // A busy worker that is slow to answer still counts as there; only a refusal marks it offline for routing.
    if (!isComfyTimeout(error) && !error?.noWorker)
      noteWorkerReachable(currentComfyBackend(), false);
    if (isDefaultBackend()) noteComfyFetchError(error);
    throw error;
  }
  comfyAnswering = true;
  noteComfyReachable();
  // A proxy in front of a stopped worker answers for it: for routing, that worker is offline.
  if ([502, 503, 504].includes(response.status)) noteWorkerReachable(currentComfyBackend(), false);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const raw = `Comfy ${response.status}: ${text || response.statusText}`;
    throw Object.assign(new Error(normalizeComfyError(raw)), { status: response.status, raw });
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.arrayBuffer();
}

export function normalizeComfyError(message = "") {
  let text = String(message || "").trim();
  const jsonMatch = text.match(/\{[\s\S]*\}$/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const nodeErrors = parsed?.node_errors || {};
      const details = Object.entries(nodeErrors).flatMap(([nodeId, node]) =>
        (node?.errors || []).map((error) => {
          const name = error?.name || node?.class_type || `node ${nodeId}`;
          const detail = error?.message || error?.type || "invalid value";
          return `${name}: ${detail}`;
        }),
      );
      text = details.length
        ? `${parsed?.error?.message || "Prompt validation failed"}: ${details.slice(0, 3).join("; ")}`
        : parsed?.error?.message || text;
    } catch {
      // Keep the original ComfyUI error text.
    }
  }
  if (/float4_e2m1fn_x2/i.test(text)) {
    return "This NVFP4 model needs a newer PyTorch build. Use a non-NVFP4 model or update ComfyUI's PyTorch.";
  }
  // Only ComfyUI's own out-of-memory wording: "illegal memory access" or an
  // "allocation" in some other message is a different failure.
  if (/out of memory|OutOfMemoryError|Allocation on device/i.test(text)) {
    return "ComfyUI ran out of GPU memory. Try a smaller size, fewer steps, or a lighter model.";
  }
  if (/cannot import|no module named|module .* has no attribute|attributeerror/i.test(text)) {
    return "ComfyUI hit a Python error. Check that the model, custom nodes and PyTorch version work together.";
  }
  return text || "ComfyUI request failed.";
}

export function optionsFor(info, node, key) {
  const input = info?.[node]?.input?.required?.[key];
  if (!Array.isArray(input)) return [];
  if (Array.isArray(input[0])) return input[0];
  if (Array.isArray(input[1]?.options)) return input[1].options;
  return [];
}

export function hasNode(info, node) {
  return Boolean(info?.[node]);
}

export function missingNodes(info, nodes = []) {
  return nodes.filter((node) => !hasNode(info, node));
}
export function nodeRange(info, node, key, fallback = {}) {
  const meta = info?.[node]?.input?.required?.[key]?.[1];
  return typeof meta === "object" && !Array.isArray(meta) ? { ...fallback, ...meta } : fallback;
}

export function textRange(info, node, key) {
  const meta = info?.[node]?.input?.required?.[key]?.[1];
  if (typeof meta !== "object" || Array.isArray(meta)) return {};
  const tooltip = String(meta.tooltip || "");
  const match = tooltip.match(/maximum(?: length)? (?:is |of )?([0-9,]+)\s*(?:characters|chars)?/i);
  const parsedMax = match ? Number(match[1].replace(/,/g, "")) : undefined;
  return {
    ...meta,
    max: Number(meta.max || meta.maxLength || meta.max_length || parsedMax || 0) || undefined,
  };
}
