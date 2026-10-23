// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generation metadata embedded in an image file (design §2.3, Resolve: image files). Pure: no
 * files, no network.
 *
 *   readImageMetadata(buffer)  the format, size and text fields of a PNG, WebP or JPEG:
 *                              PNG text chunks; EXIF UserComment, ImageDescription, Make and
 *                              Model (where ComfyUI's WebP saver keeps `workflow:` and `prompt:`);
 *                              JPEG comments.
 *   imageRecipe(metadata)      what generated it, from A1111/Forge `parameters` (with Civitai's
 *                              `Civitai resources` and `Hashes`), Civitai's JSON, or a ComfyUI
 *                              `prompt` graph (or, without one, its `workflow`). Studio's own PNGs
 *                              carry both `parameters` and the ComfyUI graph: the parameters lead
 *                              and the graph supplies the full file names.
 *
 * A recipe is `{source, prompt, negative, negativeUsed, settings: {seed, sampler, scheduler, steps,
 * cfg, width, height}, resources: [{role, folder, name, file, hash, versionId, strength}],
 * approximate: [], warnings: [], extraProcessing}`; null when the image records nothing.
 */

import zlib from "node:zlib";

/* --------------------------------------------------------------- Samplers */

/** AUTOMATIC1111's sampler names as ComfyUI's. */
export const a1111Samplers = Object.freeze({
  "DPM++ 2M": "dpmpp_2m",
  "DPM++ 2M SDE": "dpmpp_2m_sde",
  "DPM++ 2S a": "dpmpp_2s_ancestral",
  "DPM++ 3M SDE": "dpmpp_3m_sde",
  "DPM++ SDE": "dpmpp_sde",
  DDIM: "ddim",
  DPM2: "dpm_2",
  "DPM2 a": "dpm_2_ancestral",
  Euler: "euler",
  "Euler a": "euler_ancestral",
  Heun: "heun",
  LCM: "lcm",
  LMS: "lms",
  UniPC: "uni_pc",
});
/** AUTOMATIC1111's schedule types as ComfyUI's schedulers. */
export const a1111Schedules = Object.freeze({
  Automatic: "normal",
  Beta: "beta",
  Exponential: "exponential",
  Karras: "karras",
  "SGM Uniform": "sgm_uniform",
  Simple: "simple",
  Uniform: "normal",
  "DDIM Uniform": "ddim_uniform",
  "KL Optimal": "kl_optimal",
});

/** An A1111 sampler (and schedule) as ComfyUI's, with what couldn't be mapped. */
export function comfySampling(samplerName = "", scheduleName = "") {
  const approximate = [];
  const raw = String(samplerName || "").trim();
  const suffix = raw.match(/ (Karras|Exponential|SGM Uniform)$/i)?.[1] || "";
  const name = suffix ? raw.slice(0, -suffix.length - 1) : raw;
  const known = Object.keys(a1111Samplers).find((key) => key.toLowerCase() === name.toLowerCase());
  const comfyNames = new Set(Object.values(a1111Samplers));
  const sampler = known ? a1111Samplers[known] : comfyNames.has(name) ? name : "";
  if (name && !sampler) approximate.push(`Sampler “${name}” needs a manual choice`);
  const schedule = String(scheduleName || suffix || "").trim();
  const scheduler =
    Object.entries(a1111Schedules).find(
      ([key]) => key.toLowerCase() === schedule.toLowerCase(),
    )?.[1] || (Object.values(a1111Schedules).includes(schedule) ? schedule : "");
  if (schedule && !scheduler) approximate.push(`Schedule “${schedule}” needs a manual choice`);
  if (sampler && !schedule)
    approximate.push("No sampling schedule was recorded; the workflow’s default will be used");
  return { sampler, scheduler, approximate };
}

/* ----------------------------------------------------------- Containers */

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const maxText = 4 * 1024 * 1024;

/** png, webp or jpeg from the first bytes; null for anything else. */
export function imageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(pngSignature)) return "png";
  if (buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP")
    return "webp";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  return null;
}

/** A PNG's size and text chunks, keyword → value (the first one wins). */
export function pngMetadata(buffer) {
  const info = { width: 0, height: 0, text: {} };
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const start = offset + 8;
    if (start + length > buffer.length || type === "IEND") break;
    if (type === "IHDR" && length >= 8) {
      info.width = buffer.readUInt32BE(start);
      info.height = buffer.readUInt32BE(start + 4);
    } else if ((type === "tEXt" || type === "zTXt" || type === "iTXt") && length <= maxText) {
      const text = pngText(type, buffer.subarray(start, start + length));
      if (text && !(text.keyword in info.text)) info.text[text.keyword] = text.value;
    }
    offset = start + length + 4;
  }
  return info;
}

function pngText(type, data) {
  const zero = data.indexOf(0);
  if (zero < 1) return null;
  const keyword = data.subarray(0, zero).toString("latin1");
  try {
    if (type === "tEXt") return { keyword, value: data.subarray(zero + 1).toString("latin1") };
    if (type === "zTXt")
      return { keyword, value: zlib.inflateSync(data.subarray(zero + 2)).toString("latin1") };
    const compressed = data[zero + 1] === 1;
    const languageEnd = data.indexOf(0, zero + 3);
    const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
    if (translatedEnd < 0) return null;
    const body = data.subarray(translatedEnd + 1);
    return { keyword, value: (compressed ? zlib.inflateSync(body) : body).toString("utf8") };
  } catch {
    return null;
  }
}

/** EXIF (a TIFF block) → the text tags Studio reads. */
export function exifText(exif) {
  const out = {};
  if (!Buffer.isBuffer(exif)) return out;
  let tiff = exif;
  if (tiff.toString("latin1", 0, 6) === "Exif\0\0") tiff = tiff.subarray(6);
  if (tiff.length < 8) return out;
  const order = tiff.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") return out;
  const little = order === "II";
  const u16 = (at) =>
    at + 2 <= tiff.length ? (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at)) : 0;
  const u32 = (at) =>
    at + 4 <= tiff.length ? (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at)) : 0;
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 7: 1 };
  const value = (entry) => {
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    const bytes = (sizes[type] || 0) * count;
    if (!bytes || bytes > maxText) return null;
    const at = bytes <= 4 ? entry + 8 : u32(entry + 8);
    if (at + bytes > tiff.length) return null;
    return { type, data: tiff.subarray(at, at + bytes) };
  };
  const readIfd = (at, tags) => {
    const count = u16(at);
    if (!count || at + 2 + count * 12 > tiff.length) return;
    for (let index = 0; index < count; index += 1) {
      const entry = at + 2 + index * 12;
      tags(u16(entry), entry);
    }
  };
  const ascii = (data) => data.toString("utf8").replace(/\0+$/, "");
  let exifIfd = 0;
  readIfd(u32(4), (tag, entry) => {
    const found = tag === 0x8769 ? null : value(entry);
    if (tag === 0x8769) exifIfd = u32(entry + 8);
    else if (tag === 0x010e && found) out.imageDescription = ascii(found.data);
    else if (tag === 0x010f && found) out.make = ascii(found.data);
    else if (tag === 0x0110 && found) out.model = ascii(found.data);
    else if (tag === 0x9c9c && found)
      out.xpComment = found.data.toString("utf16le").replace(/\0+$/, "");
  });
  if (exifIfd)
    readIfd(exifIfd, (tag, entry) => {
      if (tag !== 0x9286) return;
      const found = value(entry);
      if (found) out.userComment = userComment(found.data);
    });
  return out;
}

/** EXIF UserComment: an 8-byte charset header, then the text (A1111 writes UNICODE as UTF-16). */
function userComment(data) {
  const head = data.toString("latin1", 0, 8);
  const body = data.subarray(8);
  if (head.startsWith("UNICODE")) {
    // A1111 (piexif) writes big-endian; some tools little-endian. Pick the one that reads as text.
    const swapped = Buffer.from(body);
    if (swapped.length % 2) return "";
    swapped.swap16();
    const be = swapped.toString("utf16le").replace(/\0+$/, "");
    const le = body.toString("utf16le").replace(/\0+$/, "");
    const printable = (text) =>
      (text.match(/[\x20-\x7e\n]/g) || []).length / Math.max(1, text.length);
    return printable(be) >= printable(le) ? be : le;
  }
  if (head.startsWith("ASCII") || head === "\0\0\0\0\0\0\0\0")
    return body.toString("utf8").replace(/\0+$/, "");
  return data.toString("utf8").replace(/\0+$/, "");
}

/** A WebP's size and its EXIF and XMP chunks. */
export function webpMetadata(buffer) {
  const info = { width: 0, height: 0, exif: null, xmp: "" };
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("latin1", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > buffer.length) break;
    const data = buffer.subarray(start, start + length);
    if (type === "VP8X" && length >= 10) {
      info.width = 1 + data.readUIntLE(4, 3);
      info.height = 1 + data.readUIntLE(7, 3);
    } else if (type === "VP8 " && length >= 10 && !info.width) {
      info.width = data.readUInt16LE(6) & 0x3fff;
      info.height = data.readUInt16LE(8) & 0x3fff;
    } else if (type === "VP8L" && length >= 5 && !info.width) {
      const bits = data.readUInt32LE(1);
      info.width = (bits & 0x3fff) + 1;
      info.height = ((bits >> 14) & 0x3fff) + 1;
    } else if (type === "EXIF") info.exif = data;
    else if (type === "XMP ") info.xmp = data.toString("utf8");
    offset = start + length + (length % 2);
  }
  return info;
}

/** A JPEG's size, its EXIF block and its comments. */
export function jpegMetadata(buffer) {
  const info = { width: 0, height: 0, exif: null, comments: [] };
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    const start = offset + 4;
    const data = buffer.subarray(start, Math.min(buffer.length, offset + 2 + length));
    if (marker === 0xe1 && data.toString("latin1", 0, 6) === "Exif\0\0" && !info.exif)
      info.exif = data;
    else if (marker === 0xfe) info.comments.push(data.toString("utf8"));
    else if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      ) &&
      data.length >= 5
    ) {
      info.height = data.readUInt16BE(1);
      info.width = data.readUInt16BE(3);
    }
    offset += 2 + length;
  }
  return info;
}

/**
 * The format, size and text fields of an image: `parameters` (A1111 text), `prompt` and
 * `workflow` (ComfyUI JSON), `civitai` (Civitai's JSON), `comment`. Null for an unknown format.
 */
export function readImageMetadata(buffer) {
  const format = imageFormat(buffer);
  if (!format) return null;
  if (format === "png") {
    const png = pngMetadata(buffer);
    const text = { ...png.text };
    // Some tools keep the A1111 text under Comment or Description.
    for (const key of ["Comment", "Description", "UserComment"])
      if (!text.parameters && typeof text[key] === "string" && /\nSteps:\s*\d/.test(text[key]))
        text.parameters = text[key];
    return { format, width: png.width, height: png.height, text };
  }
  const container = format === "webp" ? webpMetadata(buffer) : jpegMetadata(buffer);
  const exif = exifText(container.exif);
  const text = {};
  const place = (value) => {
    const textValue = String(value || "").trim();
    if (!textValue) return;
    if (/^workflow:\s*\{/.test(textValue)) text.workflow ||= textValue.replace(/^workflow:\s*/, "");
    else if (/^prompt:\s*\{/.test(textValue)) text.prompt ||= textValue.replace(/^prompt:\s*/, "");
    else if (/^\{/.test(textValue)) {
      const parsed = parseJson(textValue);
      if (
        parsed &&
        (typeof parsed.prompt === "string" ||
          parsed.negativePrompt !== undefined ||
          parsed.resources)
      )
        text.civitai ||= textValue;
      else if (parsed && Object.values(parsed).some((node) => node?.class_type))
        text.prompt ||= textValue;
    } else if (/\bSteps:\s*\d/.test(textValue) || !text.parameters) text.parameters ||= textValue;
  };
  for (const value of [
    exif.userComment,
    exif.imageDescription,
    exif.xpComment,
    exif.make,
    exif.model,
    ...(container.comments || []),
  ])
    place(value);
  if (text.parameters && !/\bSteps:\s*\d/.test(text.parameters) && text.parameters.length < 3)
    delete text.parameters;
  return { format, width: container.width, height: container.height, text };
}

/* -------------------------------------------------------------- Parsers */

function parseJson(text) {
  if (typeof text !== "string") return text && typeof text === "object" ? text : null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** "Key: value, Key: "quoted, value", Key: [json], …" → {Key: value}. */
export function parseSettingsLine(line = "") {
  const settings = {};
  let index = 0;
  const text = String(line);
  while (index < text.length) {
    while (text[index] === " " || text[index] === ",") index += 1;
    const colon = text.indexOf(":", index);
    if (colon < 0) break;
    const key = text.slice(index, colon).trim();
    index = colon + 1;
    while (text[index] === " ") index += 1;
    let value = "";
    if (text[index] === '"' || text[index] === "[" || text[index] === "{") {
      const open = text[index];
      const close = open === '"' ? '"' : open === "[" ? "]" : "}";
      let depth = 0;
      let quoted = false;
      const start = index;
      for (; index < text.length; index += 1) {
        const char = text[index];
        if (quoted) {
          if (char === "\\") index += 1;
          else if (char === '"') {
            quoted = false;
            if (open === '"') {
              index += 1;
              break;
            }
          }
          continue;
        }
        if (char === '"') {
          quoted = true;
          continue;
        }
        if (char === open) depth += 1;
        else if (char === close) {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            break;
          }
        }
      }
      value = text.slice(start, index);
      if (open === '"') {
        try {
          value = JSON.parse(value);
        } catch {
          value = value.slice(1, -1);
        }
      }
    } else {
      const comma = text.indexOf(",", index);
      value = text.slice(index, comma < 0 ? text.length : comma).trim();
      index = comma < 0 ? text.length : comma;
    }
    if (key) settings[key] = value;
  }
  return settings;
}

const number = (value, min, max) => {
  if (value === null || value === undefined || value === "") return undefined;
  const result = Number(value);
  return Number.isFinite(result) && result >= min && result <= max ? result : undefined;
};
const seedOf = (value) =>
  /^\d{1,20}$/.test(String(value ?? "").trim()) &&
  (typeof value !== "number" || Number.isSafeInteger(value))
    ? String(value).trim()
    : "";
const baseName = (name = "") =>
  String(name || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
/** A file name without its folder and model extension, lowercased, for comparing names. */
export const fileStem = (name = "") =>
  baseName(name)
    .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, "")
    .toLowerCase();
const hashOf = (value) =>
  /^[a-f0-9]{8,64}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : "";
const folders = {
  checkpoint: "checkpoints",
  diffusion_model: "diffusion_models",
  lora: "loras",
  vae: "vae",
  text_encoder: "text_encoders",
};
const civitaiRoles = {
  checkpoint: "checkpoint",
  model: "checkpoint",
  lora: "lora",
  locon: "lora",
  lycoris: "lora",
  dora: "lora",
  vae: "vae",
  textencoder: "text_encoder",
  "text encoder": "text_encoder",
  embed: "",
  embedding: "",
  textualinversion: "",
};

function resource(role, fields) {
  const item = {
    role,
    folder: folders[role],
    name: fields.name || baseName(fields.file) || "",
    file: fields.file ? baseName(fields.file) : "",
    hash: hashOf(fields.hash),
    versionId:
      Number.isSafeInteger(fields.versionId) && fields.versionId > 0 ? fields.versionId : 0,
  };
  if (role === "lora") item.strength = number(fields.strength, -100, 100) ?? null;
  return item;
}

/** Adds a resource unless one of the same role already names it (by version, hash or name). */
function addResource(list, item) {
  if (!item.name && !item.file && !item.hash && !item.versionId) return;
  const same = list.find(
    (other) =>
      other.role === item.role &&
      ((item.versionId && other.versionId === item.versionId) ||
        (item.hash &&
          other.hash &&
          (other.hash.startsWith(item.hash) || item.hash.startsWith(other.hash))) ||
        (fileStem(item.file || item.name) &&
          fileStem(other.file || other.name) === fileStem(item.file || item.name))),
  );
  if (!same) {
    list.push(item);
    return;
  }
  for (const key of ["file", "hash", "versionId"])
    if (!same[key] && item[key]) same[key] = item[key];
  if (same.name === same.file && item.name && item.name !== item.file) same.name = item.name;
  if (
    item.role === "lora" &&
    (same.strength === null || same.strength === undefined) &&
    item.strength !== null
  )
    same.strength = item.strength;
}

/** A1111, Forge and Civitai's `parameters` text. */
export function a1111Recipe(text = "") {
  const source = String(text || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!source) return null;
  const lines = source.split("\n");
  let settingsLine = "";
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^Steps:\s*\d+/.test(lines[index])) {
      settingsLine = lines.splice(index).join(", ");
      break;
    }
  }
  const body = lines.join("\n");
  const negativeAt = body.search(/(^|\n)Negative prompt:/);
  const rawPrompt = (negativeAt >= 0 ? body.slice(0, negativeAt) : body).trim();
  const negative =
    negativeAt >= 0
      ? body
          .slice(negativeAt)
          .replace(/^\n?Negative prompt:\s*/, "")
          .trim()
      : "";
  const settings = parseSettingsLine(settingsLine);
  if (!rawPrompt && !settingsLine) return null;
  const recipe = {
    source: /Studio /.test(String(settings.Version || ""))
      ? "studio"
      : settings["Civitai resources"] || settings["Civitai metadata"]
        ? "civitai"
        : "a1111",
    prompt: "",
    negative,
    negativeUsed: Boolean(negative),
    settings: {},
    resources: [],
    approximate: [],
    warnings: [],
    extraProcessing: false,
  };
  const [width, height] = String(settings.Size || "")
    .split("x")
    .map(Number);
  for (const [key, value] of [
    ["steps", number(settings.Steps, 1, 10000)],
    ["cfg", number(settings["CFG scale"], 0, 100)],
    ["width", number(width, 16, 16384)],
    ["height", number(height, 16, 16384)],
  ])
    if (value !== undefined) recipe.settings[key] = value;
  if (seedOf(settings.Seed)) recipe.settings.seed = seedOf(settings.Seed);
  else if (settings.Seed !== undefined)
    recipe.warnings.push("The seed couldn’t be read exactly; a random seed will be used.");
  const sampling = comfySampling(settings.Sampler, settings["Schedule type"]);
  if (sampling.sampler) recipe.settings.sampler = sampling.sampler;
  if (sampling.scheduler) recipe.settings.scheduler = sampling.scheduler;
  recipe.approximate.push(...sampling.approximate);
  const hashes = parseJson(settings.Hashes) || {};
  if (settings.Model || settings["Model hash"] || hashes.model)
    addResource(
      recipe.resources,
      resource("checkpoint", {
        name: settings.Model || "",
        hash: settings["Model hash"] || hashes.model,
      }),
    );
  if (settings.VAE || hashes.vae || settings["VAE hash"])
    addResource(
      recipe.resources,
      resource("vae", {
        name: settings.VAE || "VAE",
        file: /\./.test(settings.VAE || "") ? settings.VAE : "",
        hash: settings["VAE hash"] || hashes.vae,
      }),
    );
  // LoRAs: the prompt's <lora:name:weight> tags, then their hashes.
  const loraHashes = {};
  for (const part of String(settings["Lora hashes"] || "").split(",")) {
    const [name, hash] = part.split(":").map((item) => item?.trim());
    if (name && hashOf(hash)) loraHashes[name.toLowerCase()] = hash;
  }
  for (const [key, hash] of Object.entries(hashes))
    if (/^lora:/i.test(key) && hashOf(hash)) loraHashes[key.slice(5).toLowerCase()] ||= hash;
  for (const match of rawPrompt.matchAll(/<(?:lora|lyco):([^:>]+)(?::([^:>]+))?[^>]*>/gi)) {
    const name = match[1].trim();
    addResource(
      recipe.resources,
      resource("lora", { name, hash: loraHashes[name.toLowerCase()], strength: match[2] ?? 1 }),
    );
  }
  for (const [name, hash] of Object.entries(loraHashes))
    if (!recipe.resources.some((item) => item.role === "lora" && item.name.toLowerCase() === name))
      addResource(recipe.resources, resource("lora", { name, hash, strength: null }));
  // Civitai's on-site generator lists exact versions.
  for (const item of Array.isArray(parseJson(settings["Civitai resources"]))
    ? parseJson(settings["Civitai resources"])
    : []) {
    const role = civitaiRoles[String(item?.type || "").toLowerCase()];
    if (!role) continue;
    addResource(
      recipe.resources,
      resource(role, {
        name: item.modelName || "",
        versionId: Number(item.modelVersionId),
        strength: item.weight ?? item.strength ?? 1,
      }),
    );
  }
  recipe.prompt = rawPrompt
    .replace(/<(?:lora|lyco):[^>]+>/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
  if (Object.keys(settings).some((key) => /^Hires|ControlNet|ADetailer|^Refiner/i.test(key)))
    recipe.extraProcessing = true;
  if (settings["Clip skip"] && Number(settings["Clip skip"]) !== 1)
    recipe.warnings.push(`CLIP skip ${settings["Clip skip"]} needs a matching workflow.`);
  if (settings["Denoising strength"] && !recipe.extraProcessing)
    recipe.warnings.push("The image was made from another image; that source isn’t included.");
  return recipe;
}

/** Civitai's JSON (an EXIF UserComment, or `meta` from its API). */
export function civitaiJsonRecipe(value) {
  const meta = parseJson(value);
  if (!meta || (typeof meta.prompt !== "string" && !meta.resources && !meta.civitaiResources))
    return null;
  const recipe = {
    source: "civitai",
    prompt: String(meta.prompt || "")
      .replace(/<(?:lora|lyco):[^>]+>/gi, "")
      .trim(),
    negative: String(meta.negativePrompt || ""),
    negativeUsed: Boolean(meta.negativePrompt),
    settings: {},
    resources: [],
    approximate: [],
    warnings: [],
    extraProcessing: false,
  };
  const [width, height] = String(meta.Size || "")
    .split("x")
    .map(Number);
  for (const [key, raw, min, max] of [
    ["steps", meta.steps ?? meta.Steps, 1, 10000],
    ["cfg", meta.cfgScale ?? meta["CFG scale"], 0, 100],
    ["width", width || meta.width, 16, 16384],
    ["height", height || meta.height, 16, 16384],
  ]) {
    const result = number(raw, min, max);
    if (result !== undefined) recipe.settings[key] = result;
  }
  const seed = meta.seed ?? meta.Seed;
  if (seedOf(seed)) recipe.settings.seed = seedOf(seed);
  const sampling = comfySampling(
    meta.sampler || meta.Sampler,
    meta["Schedule type"] || meta.scheduler,
  );
  if (sampling.sampler) recipe.settings.sampler = sampling.sampler;
  if (sampling.scheduler) recipe.settings.scheduler = sampling.scheduler;
  recipe.approximate.push(...sampling.approximate);
  if (meta.Model || meta["Model hash"])
    addResource(
      recipe.resources,
      resource("checkpoint", { name: meta.Model || "", hash: meta["Model hash"] }),
    );
  for (const item of Array.isArray(meta.civitaiResources) ? meta.civitaiResources : []) {
    const role = civitaiRoles[String(item?.type || "").toLowerCase()];
    if (role)
      addResource(
        recipe.resources,
        resource(role, {
          name: item.modelName || "",
          versionId: Number(item.modelVersionId),
          strength: item.weight ?? item.strength ?? 1,
        }),
      );
  }
  for (const item of Array.isArray(meta.resources) ? meta.resources : []) {
    const role = civitaiRoles[String(item?.type || "").toLowerCase()];
    if (role)
      addResource(
        recipe.resources,
        resource(role, {
          name: item.name || "",
          hash: item.hash,
          versionId: Number(item.modelVersionId),
          strength: item.weight ?? item.strength ?? 1,
        }),
      );
  }
  for (const match of String(meta.prompt || "").matchAll(
    /<(?:lora|lyco):([^:>]+)(?::([^:>]+))?[^>]*>/gi,
  ))
    addResource(
      recipe.resources,
      resource("lora", { name: match[1].trim(), strength: match[2] ?? 1 }),
    );
  if (Object.keys(meta).some((key) => /hires|controlnet|adetailer/i.test(key)))
    recipe.extraProcessing = true;
  return recipe;
}

/* -------------------------------------------------------------- ComfyUI */

// Widget order in a saved (UI) workflow, for the nodes a recipe reads.
const widgetNames = {
  KSampler: ["seed", null, "steps", "cfg", "sampler_name", "scheduler", "denoise"],
  KSamplerAdvanced: [
    null,
    "noise_seed",
    null,
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "start_at_step",
    "end_at_step",
    null,
  ],
  CLIPTextEncode: ["text"],
  CheckpointLoaderSimple: ["ckpt_name"],
  UNETLoader: ["unet_name", "weight_dtype"],
  UnetLoaderGGUF: ["unet_name"],
  LoraLoader: ["lora_name", "strength_model", "strength_clip"],
  LoraLoaderModelOnly: ["lora_name", "strength_model"],
  VAELoader: ["vae_name"],
  CLIPLoader: ["clip_name", "type"],
  CLIPLoaderGGUF: ["clip_name", "type"],
  DualCLIPLoader: ["clip_name1", "clip_name2", "type"],
  EmptyLatentImage: ["width", "height", "batch_size"],
  EmptySD3LatentImage: ["width", "height", "batch_size"],
  RandomNoise: ["noise_seed"],
  KSamplerSelect: ["sampler_name"],
  BasicScheduler: ["scheduler", "steps", "denoise"],
  CFGGuider: ["cfg"],
  FluxGuidance: ["guidance"],
};

/** A saved ComfyUI workflow (UI format) as a prompt graph (API format), for the nodes above. */
export function workflowGraph(workflow) {
  const value = parseJson(workflow);
  if (!value || !Array.isArray(value.nodes)) return null;
  const links = new Map(
    (Array.isArray(value.links) ? value.links : [])
      .filter(Array.isArray)
      .map((link) => [link[0], [String(link[1]), link[2]]]),
  );
  const graph = {};
  for (const node of value.nodes) {
    if (!node || node.mode === 4 || node.mode === 2) continue;
    const inputs = {};
    const names = widgetNames[node.type] || [];
    const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
    names.forEach((name, index) => {
      if (name && widgets[index] !== undefined) inputs[name] = widgets[index];
    });
    for (const input of Array.isArray(node.inputs) ? node.inputs : [])
      if (input?.link !== null && input?.link !== undefined && links.has(input.link))
        inputs[input.name] = links.get(input.link);
    graph[String(node.id)] = { class_type: node.type, inputs };
  }
  return graph;
}

const samplerTypes = ["KSampler", "KSamplerAdvanced", "SamplerCustomAdvanced", "SamplerCustom"];
const isLink = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  (typeof value[0] === "string" || typeof value[0] === "number");

/** A ComfyUI prompt graph (API format) as a recipe. */
export function comfyRecipe(prompt) {
  const graph = parseJson(prompt);
  if (!graph || Array.isArray(graph)) return null;
  const nodes = Object.entries(graph).filter(
    ([, node]) => node && typeof node === "object" && typeof node.class_type === "string",
  );
  if (!nodes.length) return null;
  const node = (link) => (isLink(link) ? graph[String(link[0])] : null);
  /** A widget value, following a link to a primitive or string node. */
  const scalar = (value, depth = 0) => {
    if (!isLink(value)) return value;
    const source = node(value);
    if (!source || depth > 6) return undefined;
    const inputs = source.inputs || {};
    for (const key of ["value", "text", "string", "seed", "noise_seed", "int", "float", "Text"])
      if (inputs[key] !== undefined) return scalar(inputs[key], depth + 1);
    return undefined;
  };
  /** The text behind a conditioning link. */
  const conditioningText = (link, depth = 0) => {
    const source = node(link);
    if (!source || depth > 12) return { text: "", zero: false };
    const inputs = source.inputs || {};
    if (/ConditioningZeroOut/.test(source.class_type)) return { text: "", zero: true };
    if (/CLIPTextEncode|TextEncode/.test(source.class_type)) {
      const text = [inputs.text, inputs.t5xxl, inputs.clip_l, inputs.prompt]
        .map((value) => scalar(value))
        .find((value) => typeof value === "string");
      if (typeof text === "string") return { text, zero: false };
    }
    for (const key of ["conditioning", "conditioning_1", "positive", "conditioning_to"])
      if (isLink(inputs[key])) return conditioningText(inputs[key], depth + 1);
    return { text: "", zero: false };
  };
  const [, sampler] =
    nodes.find(
      ([, item]) =>
        samplerTypes.includes(item.class_type) &&
        (isLink(item.inputs?.positive) || isLink(item.inputs?.guider)),
    ) ||
    nodes.find(([, item]) => samplerTypes.includes(item.class_type)) ||
    [];
  const recipe = {
    source: "comfyui",
    prompt: "",
    negative: "",
    negativeUsed: false,
    settings: {},
    resources: [],
    approximate: [],
    warnings: [],
    extraProcessing: false,
  };
  if (sampler) {
    const inputs = sampler.inputs || {};
    let positive = inputs.positive;
    let negative = inputs.negative;
    let cfg = scalar(inputs.cfg);
    let seed = scalar(inputs.seed ?? inputs.noise_seed);
    let samplerName = scalar(inputs.sampler_name);
    let scheduler = scalar(inputs.scheduler);
    let steps = scalar(inputs.steps);
    if (sampler.class_type === "SamplerCustomAdvanced" || sampler.class_type === "SamplerCustom") {
      const guider = node(inputs.guider)?.inputs || {};
      positive = guider.positive ?? guider.conditioning ?? positive;
      negative = guider.negative ?? negative;
      cfg ??= scalar(guider.cfg);
      seed ??= scalar(node(inputs.noise)?.inputs?.noise_seed);
      samplerName ??= scalar(node(inputs.sampler)?.inputs?.sampler_name);
      const sigmas = node(inputs.sigmas)?.inputs || {};
      scheduler ??= scalar(sigmas.scheduler);
      steps ??= scalar(sigmas.steps);
    }
    // FLUX-style guidance stands in for CFG.
    const guidance = (() => {
      let current = node(positive);
      for (let depth = 0; current && depth < 12; depth += 1) {
        if (current.class_type === "FluxGuidance") return scalar(current.inputs?.guidance);
        current = node(current.inputs?.conditioning);
      }
      return undefined;
    })();
    const positiveText = conditioningText(positive);
    const negativeText = isLink(negative) ? conditioningText(negative) : { text: "", zero: true };
    recipe.prompt = String(positiveText.text || "").trim();
    recipe.negative = String(negativeText.text || "").trim();
    recipe.negativeUsed = Boolean(recipe.negative);
    for (const [key, value, min, max] of [
      ["steps", steps, 1, 10000],
      ["cfg", cfg ?? guidance, 0, 100],
    ]) {
      const result = number(value, min, max);
      if (result !== undefined) recipe.settings[key] = result;
    }
    if (seedOf(seed)) recipe.settings.seed = seedOf(seed);
    if (typeof samplerName === "string" && samplerName) recipe.settings.sampler = samplerName;
    if (typeof scheduler === "string" && scheduler) recipe.settings.scheduler = scheduler;
    // The latent's size, through any chain of latent nodes.
    let latent = node(inputs.latent_image);
    for (let depth = 0; latent && depth < 8; depth += 1) {
      const width = number(scalar(latent.inputs?.width), 16, 16384);
      const height = number(scalar(latent.inputs?.height), 16, 16384);
      if (width && height) {
        recipe.settings.width = width;
        recipe.settings.height = height;
        break;
      }
      latent = node(latent.inputs?.samples ?? latent.inputs?.latent ?? latent.inputs?.pixels);
    }
    if (!recipe.settings.width) {
      const sized = nodes
        .map(([, item]) => item)
        .find(
          (item) => /Latent/.test(item.class_type) && number(scalar(item.inputs?.width), 16, 16384),
        );
      if (sized) {
        recipe.settings.width = number(scalar(sized.inputs.width), 16, 16384);
        recipe.settings.height = number(scalar(sized.inputs.height), 16, 16384);
      }
    }
    if (number(scalar(inputs.denoise), 0, 1) !== undefined && Number(scalar(inputs.denoise)) < 1)
      recipe.warnings.push("The image was made from another image; that source isn’t included.");
  } else recipe.warnings.push("No sampler was found in the ComfyUI graph.");
  for (const [, item] of nodes) {
    const inputs = item.inputs || {};
    const type = item.class_type;
    if (type === "CheckpointLoaderSimple" || type === "CheckpointLoader")
      addResource(recipe.resources, resource("checkpoint", { file: scalar(inputs.ckpt_name) }));
    else if (/^UNETLoader|^UnetLoaderGGUF|DiffusionModelLoader/.test(type))
      addResource(
        recipe.resources,
        resource("diffusion_model", { file: scalar(inputs.unet_name ?? inputs.model_name) }),
      );
    else if (/^LoraLoader/.test(type) && typeof scalar(inputs.lora_name) === "string")
      addResource(
        recipe.resources,
        resource("lora", {
          file: scalar(inputs.lora_name),
          strength: scalar(inputs.strength_model ?? inputs.strength) ?? 1,
        }),
      );
    else if (type === "VAELoader")
      addResource(recipe.resources, resource("vae", { file: scalar(inputs.vae_name) }));
    else if (/CLIPLoader/.test(type))
      for (const key of ["clip_name", "clip_name1", "clip_name2", "clip_name3"]) {
        const file = scalar(inputs[key]);
        if (typeof file === "string" && file)
          addResource(recipe.resources, resource("text_encoder", { file }));
      }
    if (
      /Upscale(Model)?Loader|ControlNet|FaceDetailer|Detailer|IPAdapter|UltimateSDUpscale/i.test(
        type,
      )
    )
      recipe.extraProcessing = true;
  }
  for (const item of recipe.resources) if (typeof item.file !== "string") item.file = "";
  recipe.resources = recipe.resources.filter((item) => item.file || item.name);
  if (!recipe.prompt && !recipe.resources.length && !Object.keys(recipe.settings).length)
    return null;
  return recipe;
}

/* --------------------------------------------------------------- Recipe */

/**
 * What generated an image, from its metadata (readImageMetadata). The A1111 parameters lead;
 * a ComfyUI graph in the same file supplies full file names and anything they lack.
 */
export function imageRecipe(metadata) {
  const text = metadata?.text || {};
  const comfy = comfyRecipe(text.prompt) || comfyRecipe(workflowGraph(text.workflow));
  const primary =
    (text.parameters && !/^\s*\{/.test(text.parameters) ? a1111Recipe(text.parameters) : null) ||
    civitaiJsonRecipe(text.civitai) ||
    civitaiJsonRecipe(text.parameters);
  let recipe = primary || comfy;
  if (!recipe) return null;
  if (primary && comfy) {
    recipe = {
      ...primary,
      settings: { ...comfy.settings, ...primary.settings },
      extraProcessing: primary.extraProcessing || comfy.extraProcessing,
    };
    if (!recipe.prompt) recipe.prompt = comfy.prompt;
    if (!recipe.negative && comfy.negative) {
      recipe.negative = comfy.negative;
      recipe.negativeUsed = true;
    }
    // The graph knows each file's full name; the parameters only its stem.
    const resources = recipe.resources.map((item) => ({ ...item }));
    for (const item of comfy.resources) {
      const role =
        item.role === "diffusion_model" ? ["checkpoint", "diffusion_model"] : [item.role];
      const same = resources.find(
        (other) =>
          role.includes(other.role) && !other.file && fileStem(other.name) === fileStem(item.file),
      );
      if (same) Object.assign(same, { file: item.file, role: item.role, folder: item.folder });
      else if (
        !resources.some((other) => other.file && fileStem(other.file) === fileStem(item.file))
      )
        resources.push(item);
    }
    recipe.resources = resources;
    // A sampler the graph names exactly beats an approximate A1111 mapping.
    if (comfy.settings.sampler)
      recipe.approximate = recipe.approximate.filter(
        (reason) => !/^Sampler /.test(reason) && !/^No sampling schedule/.test(reason),
      );
    if (comfy.settings.scheduler)
      recipe.approximate = recipe.approximate.filter(
        (reason) => !/^Schedule /.test(reason) && !/^No sampling schedule/.test(reason),
      );
    if (!primary.settings.sampler && comfy.settings.sampler)
      recipe.settings.sampler = comfy.settings.sampler;
    if (!primary.settings.scheduler && comfy.settings.scheduler)
      recipe.settings.scheduler = comfy.settings.scheduler;
  }
  if (!recipe.settings.width && metadata.width && metadata.height) {
    recipe.settings.width = metadata.width;
    recipe.settings.height = metadata.height;
    recipe.approximate = [
      ...recipe.approximate,
      "The size is the image’s own; no generation size was recorded",
    ];
  }
  return recipe;
}
