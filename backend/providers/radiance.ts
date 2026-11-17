import { Agent, FormData, fetch as undiciFetch } from "undici";
/**
 * Radiance as a worker: Studio calls its OpenAI-style media API directly. A profile's Radiance
 * backend stays a one-node graph (RadianceImageGenerate or RadianceVideoGenerate beside its save
 * node) whose inputs Studio fills like any other; `imageRequest` and `videoRequest` turn that
 * node into the request. One Radiance process serves every model in its config, loading and
 * parking them itself, and reports each model's state on /v1/models.
 */

type Values = Record<string, any>;
export interface RadianceModel {
  id: string;
  /** cold, loading, resident, closing, parked or failed. */
  state: string;
}
interface RadianceVideo {
  id: string;
  status: string;
  progress?: number;
  error?: { message?: string } | string;
}
export interface RadianceFile {
  field: string;
  bytes: Uint8Array;
}

export const radianceImageNode = "RadianceImageGenerate";
export const radianceVideoNode = "RadianceVideoGenerate";

const fps = 24;
/**
 * Each video model's canvas and frame grid at 24 fps: H3 makes up to 1344 × 768 of area in 17n + 5
 * frames (5.17 to 14.4 s); LTX-2.5 makes up to 1920 × 1088 in 8n + 1 frames (0.71 to 6.7 s).
 */
export function radianceVideoLimits(model: string) {
  return isLtx(model)
    ? { maxPixels: 1920 * 1088, frames: { min: 17, max: 161, step: 8, offset: 1 } }
    : { maxPixels: 1344 * 768, frames: { min: 124, max: 345, step: 17, offset: 5 } };
}
const maxVideoReferences = 9;
const maxImageReferences = 10;
const maxVideoBytes = 2 * 1024 ** 3;

/** FastH3, H3 distilled to eight steps: text to video only, with no LoRA slot. */
export const isFastH3 = (model: string) => model.toLowerCase().includes("fasth3");
/** LTX-2.5: text or a first frame to video; the distilled release runs only its eight steps. */
const isLtx = (model: string) => model.toLowerCase().startsWith("ltx-");
const isDistilledLtx = (model: string) => isLtx(model) && model.toLowerCase().includes("distilled");

/**
 * Qwen and Noct conditioning/cache limits, shared by their profiles and requests. A one-GPU IQ8R
 * entry's 8192-token cache holds three references at 1344; its two-GPU `-refs` twin holds four
 * at 2048, and validation.js moves a run with more references than one card holds there.
 */
export function radianceImageLimits(model: string) {
  if (!/^(qwen-image-2\.1-|noctq-)/.test(model))
    return { maxSide: 2048, maxReferences: maxImageReferences };
  if (model.endsWith("-refs")) return { maxSide: 2048, maxReferences: 4 };
  return { maxSide: 1344, maxReferences: model.endsWith("-iq8r") ? 3 : 4 };
}

/**
 * Studio's CFG follows diffusers, uncond + s (cond - uncond), where 1 is unguided. Radiance's
 * Krea 2 architecture (Krea 2 and its fine-tunes) reads guidance in its card's terms,
 * cond + s (cond - uncond), where 0 is unguided, so that family's scale is one lower.
 */
function radianceGuidance(cfg: number, family: string) {
  return family === "krea2" ? Math.max(0, cfg - 1) : cfg;
}

/**
 * What the two nodes take, in ComfyUI's node-list shape, so a Radiance worker's catalogue reads
 * like any worker's: their `model` lists every model the process serves.
 */
export function radianceInfo(models: RadianceModel[], loras: string[] = []) {
  const names = models.map((model) => model.id).sort();
  const node = (required: Values, optional: Values, output: string[]) => ({
    input: { required, optional },
    input_order: { required: Object.keys(required), optional: Object.keys(optional) },
    output,
    output_node: false,
  });
  const references = (count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`images.image_${index + 1}`, ["IMAGE"]]),
    );
  const seed = ["INT", { default: 1, min: 0, max: 2 ** 53 - 1 }];
  return {
    [radianceImageNode]: node(
      {
        model: [names],
        prompt: ["STRING", { multiline: true }],
        negative_prompt: ["STRING", { default: "", multiline: true }],
        width: ["INT", { default: 1024, min: 64, max: 2048, step: 32 }],
        height: ["INT", { default: 1024, min: 64, max: 2048, step: 32 }],
        steps: ["INT", { default: 8, min: 1, max: 80 }],
        cfg: ["FLOAT", { default: 1, min: 1, max: 10, step: 0.1 }],
        seed,
        count: ["INT", { default: 1, min: 1, max: 8 }],
      },
      {
        ...references(maxImageReferences),
        loras: ["STRING", { default: "[]" }],
        rebalance: [["off", "legacy", "balanced", "detail", "subtle"], { default: "off" }],
      },
      ["IMAGE"],
    ),
    [radianceVideoNode]: node(
      {
        model: [names],
        prompt: ["STRING", { multiline: true }],
        width: ["INT", { default: 1344, min: 256, max: 2048, step: 32 }],
        height: ["INT", { default: 768, min: 256, max: 2048, step: 32 }],
        // Each model's own grid narrows this (radianceVideoLimits).
        frames: ["INT", { default: 192, min: 17, max: 345, step: 1 }],
        steps: ["INT", { default: 50, min: 1, max: 65 }],
        latent_upscale: ["INT", { default: 1, min: 1, max: 4 }],
        upscale_refine_steps: ["INT", { default: 0, min: 0, max: 65 }],
        seed,
      },
      {
        ...references(maxVideoReferences),
        loras: ["STRING", { default: "[]" }],
        negative_prompt: ["STRING", { default: "", multiline: true }],
        cfg: ["FLOAT", { default: 1, min: 1, max: 10, step: 0.1 }],
      },
      ["VIDEO", "AUDIO"],
    ),
    // The shared model library's last installed inventory, for Studio's stack validation.
    LoraLoader: node(
      {
        lora_name: [[...loras].sort()],
        strength_model: ["FLOAT", { default: 0.7, min: -100, max: 100, step: 0.01 }],
      },
      {},
      [],
    ),
    // The reference loaders and save nodes beside them, which Studio handles itself.
    LoadImage: node({ image: [[], { image_upload: true }] }, {}, ["IMAGE", "MASK"]),
    SaveImage: node({ images: ["IMAGE"], filename_prefix: ["STRING", {}] }, {}, []),
    SaveVideo: node({ video: ["VIDEO"], filename_prefix: ["STRING", {}] }, {}, []),
  };
}

/** The node's LoRA stack (a JSON list of {name, strength}) as Radiance's `loras` field. */
export function radianceLoras(value: unknown) {
  const stack = JSON.parse(String(value || "[]"));
  if (!Array.isArray(stack)) throw new Error("The LoRA stack must be a JSON list.");
  return stack.map((item: Values) => ({
    // Radiance names a LoRA by its path under the LoRA folder, without the extension.
    name: String(item?.name || "").replace(/\.safetensors$/i, ""),
    weight: Number(item?.strength ?? 1),
  }));
}

function form(fields: Values, files: RadianceFile[]) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields))
    body.set(key, typeof value === "string" ? value : JSON.stringify(value));
  for (const { field, bytes } of files)
    body.append(field, new Blob([new Uint8Array(bytes)], { type: "image/png" }), `${field}.png`);
  return body;
}

/**
 * A RadianceImageGenerate node's request for a profile of `family`; references (PNG or JPEG bytes,
 * in order) make it an edit, and `mask` (alpha below 128 may change) repaints part of the first.
 */
export function imageRequest(
  values: Values,
  references: Uint8Array[] = [],
  family = "",
  { mask, transparent = false }: { mask?: Uint8Array | null; transparent?: boolean } = {},
) {
  const model = String(values.model || "");
  const limits = radianceImageLimits(model);
  if (!String(values.prompt || "").trim()) throw new Error("Enter an image prompt.");
  if (Number(values.width) % 32 || Number(values.height) % 32)
    throw new Error("Image dimensions must be multiples of 32.");
  // A size past the model's longest side shrinks to fit on the 32-pixel grid, keeping its shape.
  const scale = Math.min(1, limits.maxSide / Math.max(Number(values.width), Number(values.height)));
  const [width, height] = [values.width, values.height].map(
    (side) => Math.floor((Number(side) * scale) / 32) * 32,
  );
  const body: Values = {
    model,
    prompt: values.prompt,
    size: `${width}x${height}`,
    seed: Number(values.seed),
    n: Number(values.count) || 1,
    output_format: "png",
    response_format: "b64_json",
  };
  const loras = radianceLoras(values.loras);
  if (loras.length) body.loras = loras;
  // Krea 2's text-tap rebalance; Radiance refuses it for other models.
  if (values.rebalance && values.rebalance !== "off") body.rebalance = values.rebalance;
  // Send the profile's exact schedule and off value; omission uses the model's own CFG default.
  // A fixed-step profile has no steps, so the model keeps its own schedule.
  const steps = Number(values.steps);
  if (steps > 0) body.num_inference_steps = steps;
  body.guidance_scale = radianceGuidance(Number(values.cfg), family);
  body.negative_prompt = String(values.negative_prompt || "");
  if (transparent) body.background = "transparent";
  if (!references.length) return { route: "/v1/images/generations", body };
  if (references.length > limits.maxReferences)
    throw new Error(`This Radiance model takes up to ${limits.maxReferences} reference images.`);
  return {
    route: "/v1/images/edits",
    body: form(body, [
      ...references.map((bytes) => ({ field: "image[]", bytes })),
      ...(mask ? [{ field: "mask", bytes: mask }] : []),
    ]),
  };
}

/** Radiance rounds seconds up to the frame grid, so this stays just below the exact frame time. */
function seconds(frames: number) {
  return frames % fps
    ? (Math.floor((frames / fps) * 1000) / 1000).toFixed(3)
    : String(frames / fps);
}

/**
 * A video size within the model's area on the 32-pixel grid, keeping its shape: a preset sized for
 * another model's area (1:1 as 1024 × 1024 on H3) shrinks to fit rather than being refused.
 */
function videoSize(width: number, height: number, maxPixels: number) {
  if (width * height <= maxPixels) return [width, height];
  const scale = Math.sqrt(maxPixels / (width * height));
  return [width, height].map((side) => Math.floor((side * scale) / 32) * 32);
}

/** A reference picture and the role its slot gives it: start, end or (otherwise) reference. */
export interface RadianceReference {
  bytes: Uint8Array;
  role?: string;
}

/**
 * A RadianceVideoGenerate node's request: its fields and media parts. Radiance reads the task off
 * the parts: H3 takes a first and last frame or up to nine references, LTX-2.5 a first frame.
 */
export function videoRequest(values: Values, images: RadianceReference[] = []) {
  const model = String(values.model || "");
  const limits = radianceVideoLimits(model);
  let [width, height] = videoSize(Number(values.width), Number(values.height), limits.maxPixels);
  const frames = Number(values.frames);
  let latentUpscale = Number(values.latent_upscale) || 1;
  // Distilled LTX-2.5 draws 960 × 544 itself and reaches larger sizes (to 1920 × 1088) through its
  // latent upsampler, whose sides are multiples of 64.
  if (isDistilledLtx(model) && width * height > 960 * 544) {
    latentUpscale = 2;
    [width, height] = [width, height].map((side) => Math.floor(side / 64) * 64);
  }
  const refineSteps = Number(values.upscale_refine_steps) || 0;
  const { min, max, step, offset } = limits.frames;
  if (!String(values.prompt || "").trim()) throw new Error("Enter a video prompt.");
  if (width % 32 || height % 32) throw new Error("Video dimensions must be multiples of 32.");
  if ((frames - offset) % step || frames < min || frames > max)
    throw new Error(
      `Video frames must follow the ${step}n + ${offset} grid, from ${min} to ${max}.`,
    );
  if (![1, 2, 4].includes(latentUpscale) || (isLtx(model) && latentUpscale > 2))
    throw new Error(`Latent upscale must be 1 (off) or 2${isLtx(model) ? "" : " or 4"}.`);
  const start = images.filter((image) => image.role === "start");
  const end = images.filter((image) => image.role === "end");
  const references = images.filter((image) => !["start", "end"].includes(image.role || ""));
  if (images.length && isFastH3(model)) throw new Error("FastH3 makes text-to-video only.");
  if (start.length > 1 || end.length > 1) throw new Error("Choose one start and one end frame.");
  if (isLtx(model) && (end.length || references.length))
    throw new Error("LTX-2.5 starts from a first frame only.");
  if ((start.length || end.length) && references.length)
    throw new Error("Use start and end frames or references, not both.");
  if (references.length > maxVideoReferences)
    throw new Error(`H3 takes up to ${maxVideoReferences} reference images.`);
  const files: RadianceFile[] = [
    ...start.map(({ bytes }) => ({
      field: isLtx(model) ? "input_reference" : "first_frame",
      bytes,
    })),
    ...end.map(({ bytes }) => ({ field: "last_frame", bytes })),
    ...references.map(({ bytes }, index) => ({ field: `ref_image_${index + 1}`, bytes })),
  ];
  const body: Values = {
    model,
    prompt: values.prompt,
    seconds: seconds(frames),
    size: `${width}x${height}`,
    seed: Number(values.seed),
  };
  const loras = radianceLoras(values.loras);
  if (loras.length) body.loras = loras;
  // FastH3 and distilled LTX-2.5 run only their trained schedules; tuning from another profile is left out.
  const fixed = isFastH3(model) ? 8 : isDistilledLtx(model) ? 8 : 0;
  const total = fixed || Number(values.steps);
  if (!fixed) body.num_inference_steps = total;
  // Only LTX-2.5's base model is guided; the others refuse a guidance scale and negative.
  if (isLtx(model) && !fixed) {
    body.guidance_scale = Number(values.cfg);
    body.negative_prompt = String(values.negative_prompt || "");
  }
  if (latentUpscale > 1) {
    body.latent_upscale = latentUpscale;
    if (refineSteps) {
      if (refineSteps >= total)
        throw new Error(`Upscale refine steps must be below the ${total}-step schedule.`);
      body.upscale_refine_steps = refineSteps;
    }
  }
  return { body: files.length ? form(body, files) : body };
}

/** Radiance's media API at one address. Errors keep Radiance's own words. */
// Radiance answers a generation only once its model has loaded (up to its 600 s load timeout) and
// the work has run, so Node fetch's 300 s header and body timeouts would drop finished work.
const patient = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
const longFetch = ((url: string, init: object) =>
  undiciFetch(url, { ...init, dispatcher: patient })) as unknown as typeof fetch;
/** Covers a cold model load plus queueing and generation. */
export const radianceWorkMs = 30 * 60_000;

export class RadianceClient {
  private base: string;
  private fetchImpl: typeof fetch;
  private key?: string;

  /** `key`: the fleet's API key (STUDIO_RADIANCE_KEY), sent when set. */
  constructor(
    base: string,
    fetchImpl: typeof fetch = longFetch,
    key = process.env.STUDIO_RADIANCE_KEY,
  ) {
    this.base = base.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.key = key;
  }

  private async call(
    method: string,
    route: string,
    body?: object | FormData,
    signal?: AbortSignal,
  ) {
    const multipart = body instanceof FormData;
    const response = await this.fetchImpl(this.base + route, {
      method,
      redirect: "error",
      signal: signal || AbortSignal.timeout(30_000),
      headers: {
        ...(body && !multipart ? { "content-type": "application/json" } : {}),
        ...(this.key ? { authorization: `Bearer ${this.key}` } : {}),
      },
      ...(body ? { body: multipart ? (body as unknown as BodyInit) : JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try {
        const answer = JSON.parse(text);
        detail = String(answer?.error?.message || answer?.error || text);
      } catch {
        // A plain-text refusal is the message itself.
      }
      throw Object.assign(
        new Error(
          `Radiance: ${detail.replace(/\s+/g, " ").trim().slice(0, 300) || `HTTP ${response.status}`}`,
        ),
        { status: response.status },
      );
    }
    return response;
  }

  async models(signal?: AbortSignal): Promise<RadianceModel[]> {
    const answer = await (await this.call("GET", "/v1/models", undefined, signal)).json();
    return (answer?.data || []).map((model: Values) => ({
      id: String(model.id),
      state: String(model.state || ""),
    }));
  }

  /** Every picture an image request made, as bytes. */
  async images(route: string, body: object | FormData, signal: AbortSignal) {
    const answer = await (await this.call("POST", route, body, signal)).json();
    const images = (answer?.data || []).map((item: Values) =>
      Buffer.from(String(item?.b64_json || ""), "base64"),
    );
    if (!images.length || images.some((bytes: Buffer) => !bytes.length))
      throw new Error("Radiance returned no generated images.");
    return images as Uint8Array[];
  }

  async createVideo(body: object | FormData, signal?: AbortSignal): Promise<RadianceVideo> {
    // The POST returns the video's id only after a cold model has loaded.
    const video = await (
      await this.call("POST", "/v1/videos", body, signal || AbortSignal.timeout(radianceWorkMs))
    ).json();
    if (!/^[\w-]+$/.test(String(video?.id || "")))
      throw new Error("Radiance returned an invalid video job identifier.");
    return video;
  }

  async video(id: string, signal?: AbortSignal): Promise<RadianceVideo> {
    return (await this.call("GET", `/v1/videos/${id}`, undefined, signal)).json();
  }

  async videoContent(id: string, signal?: AbortSignal) {
    const response = await this.call(
      "GET",
      `/v1/videos/${id}/content`,
      undefined,
      signal || AbortSignal.timeout(600_000),
    );
    if (Number(response.headers.get("content-length")) > maxVideoBytes)
      throw new Error("Radiance returned an unexpectedly large video.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error("Radiance returned no video content.");
    return bytes;
  }

  /** Frees a video job: after download, failure or cancellation. */
  async deleteVideo(id: string) {
    await this.call("DELETE", `/v1/videos/${id}`, undefined, AbortSignal.timeout(5000));
  }
}

/** Why a video job ended without its video, or "" while it runs or once it completed. */
export function videoFailure(video: RadianceVideo) {
  if (!["failed", "cancelled", "canceled", "expired"].includes(video.status)) return "";
  const detail = typeof video.error === "string" ? video.error : video.error?.message;
  return `Radiance: ${detail || `the video job ${video.status}.`}`;
}
