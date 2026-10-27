import {
  checkpointDownloads,
  encoderDownloads,
  families,
  modelDownloads,
  vaeDownloads,
  visionDownloads,
  visionKinds,
} from "./family-catalog.js";
import { existingCopy } from "./model-downloads.js";
import { encoderKinds, vaeKinds } from "./model-components.js";

/** What a download is called in the queue and the top pill: the part, not its file name. */
function partLabel(kind, key, file) {
  if (kind === "encoder" && encoderKinds[key]) return `${encoderKinds[key].label} text encoder`;
  if (kind === "encoder" && families[key.replace(/_upsampler$/, "")]?.upsampler)
    return families[key.replace(/_upsampler$/, "")].upsampler.slot.label;
  if (kind === "vae" && vaeKinds[key]) return vaeKinds[key].label;
  if (kind === "vision" && visionKinds[key]) return `${visionKinds[key].label} encoder`;
  return file;
}

/** Who publishes a Hugging Face file: the repo's owner ("Comfy-Org", a community converter). */
export function downloadSource(url = "") {
  const match = /^https:\/\/huggingface\.co\/([^/]+)\/([^/]+)\//.exec(String(url));
  return match ? { source: match[1], repo: `${match[1]}/${match[2]}` } : {};
}

/** `onDisk`: fetched already (even before a restart), ComfyUI just has not listed it yet. */
function withDisk(entry) {
  return existingCopy(entry) ? { ...entry, onDisk: true } : entry;
}

/** Every catalog download Studio will fetch, by kind. The only files the download route accepts. */
const downloadSources = {
  encoder: [encoderDownloads, "text_encoders"],
  vae: [vaeDownloads, "vae"],
  model: [modelDownloads, "diffusion_models"],
  checkpoint: [checkpointDownloads, "checkpoints"],
  vision: [visionDownloads, "clip_vision"],
};

/**
 * One catalog download by id, with the builds listed after it for the same
 * part as `alternatives`: tried in order if this one is gone or gated.
 */
export function catalogDownload(id = "") {
  const [kind, key, index] = String(id).split(":");
  const [source, folder] = downloadSources[kind] || [];
  const list = source && Object.hasOwn(source, key) ? source[key] : [];
  const at = Number(index);
  const entry = Number.isInteger(at) ? list[at] : null;
  if (!entry) return null;
  const spec = (item, position) => ({
    id: `${kind}:${key}:${position}`,
    folder,
    label: partLabel(kind, key, item.file),
    ...item,
  });
  return {
    ...spec(entry, at),
    alternatives: list.slice(at + 1).map((item, offset) => spec(item, at + 1 + offset)),
  };
}

/**
 * Catalog downloads for one exact file name in one models folder, so a file a
 * profile names gets a Download button. Only an exact match: a file under a
 * subfolder, or any other build, is not the file the profile asks for.
 */
export function catalogDownloadsForFile(file = "", folder = "") {
  const found = [];
  for (const [kind, [source, sourceFolder]] of Object.entries(downloadSources)) {
    if (sourceFolder !== folder) continue;
    for (const [key, list] of Object.entries(source)) {
      list.forEach((entry, index) => {
        if (entry.file === file)
          found.push(
            withDisk({
              id: `${kind}:${key}:${index}`,
              folder,
              label: partLabel(kind, key, entry.file),
              ...downloadSource(entry.url),
              ...entry,
            }),
          );
      });
    }
  }
  return found;
}
