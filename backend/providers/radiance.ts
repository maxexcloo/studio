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

// Krea 2 and FLUX.3 guide against an empty negative by default; Qwen-Image needs one.
const negativeOptional = ["flux-3-", "krea-2-"];
// H3 makes videos up to the area of 1344 × 768.
const videoMaxPixels = 1344 * 768;
const fps = 24;
// H3 lengths are 17n + 5 frames: 5.17 to 14.4 seconds (124 to 345 frames).
const frameRange = { min: 124, max: 345, step: 17 };
// H3's keyframe tasks name the form part of each picture in order; ref2va numbers its references.
const keyframes: Record<string, string[]> = {
  i2va: ["first_frame"],
  l2va: ["last_frame"],
  fl2va: ["first_frame", "last_frame"],
};
const videoTasks = ["t2va", ...Object.keys(keyframes), "ref2va"];
const maxImageReferences = 10;
const maxVideoReferences = 9;
const maxVideoBytes = 2 * 1024 ** 3;

const distilled = (model: string) => model.toLowerCase().includes("fasth3");
const turbo = (model: string) => model.includes("turbo");

/**
 * What the two nodes take, in ComfyUI's node-list shape, so a Radiance worker's catalogue reads
 * like any worker's: their `model` lists every model the process serves.
 */
export function radianceInfo(models: RadianceModel[]) {
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
        frames: ["INT", { default: 192, ...frameRange }],
        steps: ["INT", { default: 50, min: 1, max: 65 }],
        latent_upscale: ["INT", { default: 1, min: 1, max: 4 }],
        upscale_refine_steps: ["INT", { default: 0, min: 0, max: 65 }],
        seed,
      },
      {
        ...references(maxVideoReferences),
        loras: ["STRING", { default: "[]" }],
        task: [videoTasks, { default: "t2va" }],
      },
      ["VIDEO", "AUDIO"],
    ),
    // The save nodes beside them, which Studio handles itself.
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

/** A RadianceImageGenerate node's request; references (PNG or JPEG bytes, in order) make it an edit. */
export function imageRequest(values: Values, references: Uint8Array[] = []) {
  const model = String(values.model || "");
  const width = Number(values.width);
  const height = Number(values.height);
  if (!String(values.prompt || "").trim()) throw new Error("Enter an image prompt.");
  if (width % 32 || height % 32) throw new Error("Image dimensions must be multiples of 32.");
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
  // Turbo owns its eight-step, guidance-1 schedule: tuning carried over from another profile is
  // left out rather than failing an otherwise valid job.
  const cfg = Number(values.cfg) || 1;
  if (!turbo(model)) body.num_inference_steps = Number(values.steps);
  if (!turbo(model) && cfg > 1) {
    const negative = String(values.negative_prompt || "").trim();
    if (negativeOptional.some((prefix) => model.startsWith(prefix))) body.guidance_scale = cfg;
    else if (!negative) throw new Error("Guidance above 1 requires a negative prompt.");
    else body.true_cfg_scale = cfg;
    if (negative) body.negative_prompt = values.negative_prompt;
  }
  if (!references.length) return { route: "/v1/images/generations", body };
  if (references.length > maxImageReferences)
    throw new Error(`Radiance takes up to ${maxImageReferences} reference images.`);
  return {
    route: "/v1/images/edits",
    body: form(
      body,
      references.map((bytes) => ({ field: "image[]", bytes })),
    ),
  };
}

/** Radiance rounds seconds up to the frame grid, so this stays just below the exact frame time. */
function seconds(frames: number) {
  return frames % fps
    ? (Math.floor((frames / fps) * 1000) / 1000).toFixed(3)
    : String(frames / fps);
}

/**
 * A video size within H3's area on the 32-pixel grid, keeping its shape: a preset sized for another
 * model's area (1:1 as 1024 × 1024) shrinks to fit rather than being refused.
 */
function videoSize(width: number, height: number) {
  if (width * height <= videoMaxPixels) return [width, height];
  const scale = Math.sqrt(videoMaxPixels / (width * height));
  return [width, height].map((side) => Math.floor((side * scale) / 32) * 32);
}

/** A RadianceVideoGenerate node's request: its fields and media parts, `images` in input order. */
export function videoRequest(values: Values, images: Uint8Array[] = []) {
  const model = String(values.model || "");
  const task = String(values.task || "t2va");
  const [width, height] = videoSize(Number(values.width), Number(values.height));
  const frames = Number(values.frames);
  const latentUpscale = Number(values.latent_upscale) || 1;
  const refineSteps = Number(values.upscale_refine_steps) || 0;
  if (!videoTasks.includes(task)) throw new Error(`task must be one of ${videoTasks.join(", ")}.`);
  if (task !== "t2va" && distilled(model)) throw new Error("FastH3 makes text-to-video only.");
  if (!String(values.prompt || "").trim()) throw new Error("Enter a video prompt.");
  if (width % 32 || height % 32) throw new Error("Video dimensions must be multiples of 32.");
  if ((frames - 5) % frameRange.step || frames < frameRange.min || frames > frameRange.max)
    throw new Error("Video frames must follow the 17n + 5 frame grid, from 124 to 345.");
  if (![1, 2, 4].includes(latentUpscale))
    throw new Error("Latent upscale must be 1 (off), 2 or 4.");
  let files: RadianceFile[] = [];
  if (keyframes[task]) {
    if (images.length !== keyframes[task].length)
      throw new Error(`${task} takes ${keyframes[task].length} image(s).`);
    if (latentUpscale > 1) throw new Error("Keyframe videos take no latent upscale.");
    files = keyframes[task].map((field, index) => ({ field, bytes: images[index] }));
  } else if (task === "ref2va") {
    if (!images.length || images.length > maxVideoReferences)
      throw new Error(`ref2va takes 1 to ${maxVideoReferences} reference images.`);
    files = images.map((bytes, index) => ({ field: `ref_image_${index + 1}`, bytes }));
  } else if (images.length)
    throw new Error("t2va takes no images; choose a keyframe or reference task.");
  const body: Values = {
    model,
    prompt: values.prompt,
    seconds: seconds(frames),
    size: `${width}x${height}`,
    seed: Number(values.seed),
  };
  const loras = radianceLoras(values.loras);
  if (loras.length) body.loras = loras;
  // FastH3 runs only its trained eight-step schedule; tuning from another profile is left out.
  const total = distilled(model) ? 8 : Number(values.steps);
  if (!distilled(model)) body.num_inference_steps = total;
  // Radiance reads text to video off a request without media.
  if (task !== "t2va") body.task = task;
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
export class RadianceClient {
  private base: string;
  private fetchImpl: typeof fetch;

  constructor(base: string, fetchImpl: typeof fetch = fetch) {
    this.base = base.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
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
      ...(body && !multipart ? { headers: { "content-type": "application/json" } } : {}),
      ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
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
    const video = await (await this.call("POST", "/v1/videos", body, signal)).json();
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
    await this.call("DELETE", `/v1/videos/${id}`, undefined, AbortSignal.timeout(5000)).catch(
      () => null,
    );
  }
}

/** Why a video job ended without its video, or "" while it runs or once it completed. */
export function videoFailure(video: RadianceVideo) {
  if (!["failed", "cancelled", "canceled", "expired"].includes(video.status)) return "";
  const detail = typeof video.error === "string" ? video.error : video.error?.message;
  return `Radiance: ${detail || `the video job ${video.status}.`}`;
}
