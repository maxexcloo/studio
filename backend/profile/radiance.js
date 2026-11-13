/**
 * Library › Profiles › Convert to Radiance: an administrator's action on a Krea 2 image profile that
 * runs on ComfyUI. Studio resolves the fine-tune's Civitai or Hugging Face file (with its published
 * SHA-256), and the worker with the model library converts it to a Radiance `.rad`
 * (studio_worker/convert.py), one at a time. Studio follows the worker's progress; when the model is
 * installed it makes the profile a combined one (profile/backends.js): its ComfyUI graph stays the
 * default and keeps references, and a text-only Radiance backend runs the new model, because
 * Radiance's Krea 2 refuses image edits.
 *
 * The worker remembers the conversion and its profile, so a Studio restart finishes it on the next
 * status read; Studio clears it on the worker once the profile has its backend.
 */
import { civitaiJson, isCivitaiHost } from "../civitai/access.js";
import { civitaiFileSpec, civitaiLink, civitaiModelFiles } from "../civitai/import.js";
import { backendIdsOf, graphFromJson, sharedProfileFields } from "../custom-workflows.js";
import { hfFetch, hfTokenValue } from "../hf-access.js";
import { resolveModelLink } from "../library/downloads.js";
import { workerRadiance } from "../worker-models.js";
import { combinedText, graphBackend } from "./backends.js";
import { readEditableProfile, saveEditableProfile } from "./editor.js";

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

/** Why a profile can't take a converted Radiance backend, or "" when it can. */
export function conversionRefusal(raw) {
  const studio = raw?.studio || {};
  if (studio.kind !== "image" || studio.family !== "krea2")
    return "Only Krea 2 image profiles convert to Radiance.";
  if (backendIdsOf(raw).length) return "This profile already has its backends.";
  if (graphBackend(raw) !== "comfyui") return "Only a profile that runs on ComfyUI converts.";
  return "";
}

/** The Radiance backend's profile for `model`: text only, with the ComfyUI profile's size, steps and LoRAs. */
function radianceProfile(studio, model) {
  const mode = studio.imageModes?.generate || studio;
  const defaults = mode.defaults || {};
  const capabilities = mode.capabilities || {};
  const inputs = {
    cfg: defaults.cfg ?? 1,
    count: defaults.count || 1,
    height: defaults.height || 1024,
    model,
    negative_prompt: "",
    prompt: "",
    seed: 0,
    steps: defaults.steps || 8,
    width: defaults.width || 1024,
    loras: "[]",
    rebalance: "off",
  };
  const controls = Object.fromEntries(
    ["count", "height", "model", "prompt", "seed", "steps", "width"].map((input) => [
      input,
      { node: "1", input },
    ]),
  );
  controls.negative = { node: "1", input: "negative_prompt" };
  return {
    studio: {
      ...Object.fromEntries(sharedProfileFields.map((field) => [field, studio[field]])),
      description: "Text generation on Radiance; references run on ComfyUI.",
      aspectPolicy: studio.aspectPolicy,
      aspectRatios: studio.aspectRatios,
      capabilities: {
        cfg: capabilities.cfg === true,
        imageToImage: false,
        inpaint: false,
        lora: capabilities.lora === true,
        negativePrompt: capabilities.negativePrompt === true,
        prompt: true,
        seed: true,
        startImage: false,
        steps: capabilities.steps === true,
        variations: true,
      },
      controls,
      defaults: {
        cfg: inputs.cfg,
        count: inputs.count,
        height: inputs.height,
        model,
        negativePrompt: "",
        steps: inputs.steps,
        width: inputs.width,
      },
      mediaInputs: [],
      ...(capabilities.lora === true
        ? { loraStack: { adapter: "radiance-tags-v1", node: "1", max: 4 } }
        : {}),
    },
    graph: {
      1: { class_type: "RadianceImageGenerate", inputs },
      2: {
        class_type: "SaveImage",
        inputs: { filename_prefix: "studio/radiance", images: ["1", 0] },
      },
    },
  };
}

/** The profile's text with a Radiance backend running `model` beside its ComfyUI one, the default. */
export function withRadianceBackend(raw, model) {
  const refusal = conversionRefusal(raw);
  if (refusal) throw invalid(refusal);
  const comfyui = { studio: raw.studio, graph: graphFromJson(raw) };
  return combinedText(raw.studio.id, raw.studio.name, "comfyui", {
    comfyui,
    radiance: radianceProfile(raw.studio, model),
  });
}

/**
 * The fine-tune's file: a Hugging Face file link, a Civitai download link with its `fileId`, or a
 * Civitai model link, whose version's fp8 file is preferred.
 */
export async function resolveFineTune(value, { json = civitaiJson, request = hfFetch } = {}) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw invalid("Paste a Civitai or Hugging Face link to the fine-tune.");
  }
  if (!isCivitaiHost(url.hostname)) return resolveModelLink(value, "diffusion_models", { request });
  const download = /^\/api\/download\/models\/([1-9]\d*)$/.exec(url.pathname);
  let versionId = download ? Number(download[1]) : civitaiLink(value, "models").versionId;
  if (!versionId)
    versionId = (await json(`models/${civitaiLink(value, "models").id}`)).modelVersions?.[0]?.id;
  if (!versionId) throw invalid("This model has no available versions.");
  const version = await json(`model-versions/${versionId}`);
  const files = civitaiModelFiles(version);
  const fileId = download && url.searchParams.get("fileId");
  const file = fileId
    ? files.find((item) => String(item.id) === fileId)
    : files.find((item) => /^fp8$/i.test(item.metadata?.fp || "")) ||
      files.find((item) => item.primary) ||
      files[0];
  const spec = file && civitaiFileSpec(version, file);
  if (!spec) throw invalid("This version has no free SafeTensors file with a published SHA-256.");
  // A version may hold several files of one precision; the file's own ID names exactly this one.
  return {
    ...spec,
    url: `https://civitai.com/api/download/models/${version.id}?fileId=${file.id}`,
  };
}

/**
 * The conversion tracker: `start`, `cancel` and `state`, each answering `{conversion}` (null when
 * none ran). `worker(body)` calls the worker's conversion route; `apply(profile, model, by)` adds
 * the backend once the model is installed.
 */
export function radianceConversions({
  worker = workerRadiance,
  resolve = resolveFineTune,
  apply = addRadianceBackend,
  pollMs = 2000,
} = {}) {
  let last = null;
  let timer = null;
  let syncing = null;

  // One status read at a time, so a finished conversion is applied once.
  const state = () => (syncing ||= sync().finally(() => (syncing = null)));

  async function sync() {
    const { conversion } = await worker({ action: "status" });
    if (!conversion) return { conversion: last };
    last = { ...conversion, applied: false };
    if (conversion.status === "done" && conversion.note?.profile) {
      try {
        await apply(conversion.note.profile, `${conversion.name}.rad`, conversion.note.by || "");
        last.applied = true;
        await worker({ action: "clear", name: conversion.name });
      } catch (error) {
        last = { ...last, status: "failed", error: error.message };
        await worker({ action: "clear", name: conversion.name });
      }
    }
    return { conversion: last };
  }

  // Studio follows a running conversion itself, so the profile changes without a page open.
  function follow() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const { conversion } = await state().catch(() => ({ conversion: last }));
      if (conversion?.status === "running") follow();
    }, pollMs);
    timer.unref?.();
  }

  return {
    state,
    async start(id, { url, name, by = "" }) {
      const refusal = conversionRefusal(JSON.parse(readEditableProfile(id).text));
      if (refusal) throw invalid(refusal);
      const spec = await resolve(url);
      const result = await worker({
        action: "start",
        name: String(name || ""),
        url: spec.url,
        size: spec.bytes,
        sha256: spec.sha256,
        tokens: {
          civitai: process.env.CIVITAI_API_TOKEN || "",
          hf: hfTokenValue(),
        },
        note: { profile: id, by },
      });
      last = { ...result.conversion, applied: false };
      follow();
      return { conversion: last };
    },
    async cancel() {
      const { conversion } = await worker({ action: "cancel" });
      last = conversion ? { ...conversion, applied: false } : last;
      return { conversion: last };
    },
  };
}

/** Adds the converted model's Radiance backend to the profile as its next version. */
export function addRadianceBackend(id, model, by) {
  const { text, hash } = readEditableProfile(id);
  return saveEditableProfile(id, withRadianceBackend(JSON.parse(text), model), {
    baseHash: hash,
    by,
  });
}
