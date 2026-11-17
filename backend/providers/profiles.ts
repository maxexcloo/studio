import sharp from "sharp";

import type { GenerationInput } from "../../shared/queue.ts";
import { modelOf } from "../domain/queue.ts";
import type { OwnedJob } from "../domain/store.ts";
import { CliProxyMedia, type CloudRequest, nativeAspects } from "./cliproxy.ts";

type Value = Record<string, any>;
// Discovery publishes no resolution schemas; an unlisted model takes the provider's default.
const resolutions: Record<string, string[]> = {
  "grok-imagine-image": [],
  "grok-imagine-image-2.0": ["1k", "2k"],
  "grok-imagine-image-quality": [],
  "grok-imagine-video": ["480p", "720p"],
  "grok-imagine-video-1.5": ["480p", "720p", "1080p"],
};
// The size a model draws for each ratio at each of its resolutions, where known. xAI publishes
// none; Grok Imagine Image 2.0's are Runware's model schema, matching sizes returned by xAI.
const nativeSizes: Record<string, Record<string, Record<string, [number, number]>>> = {
  "grok-imagine-image-2.0": {
    "1:1": { "1k": [1024, 1024], "2k": [2048, 2048] },
    "16:9": { "1k": [1280, 720], "2k": [2816, 1584] },
    "9:16": { "1k": [720, 1280], "2k": [1584, 2816] },
    "4:3": { "1k": [1152, 864], "2k": [2368, 1776] },
    "3:4": { "1k": [864, 1152], "2k": [1776, 2368] },
    "3:2": { "1k": [1248, 832], "2k": [2496, 1664] },
    "2:3": { "1k": [832, 1248], "2k": [1664, 2496] },
  },
};
/**
 * Presets of the exact ratios as the size chip lists them: the model's own 1K size, with its size
 * per resolution, where known; else about a megapixel.
 */
export function aspectPresets(model: string) {
  return nativeAspects.map((label) => {
    const known = nativeSizes[model]?.[label];
    const [x, y] = label.split(":").map(Number);
    const scale = Math.round(Math.sqrt((1024 * 1024) / (x * y)));
    const [w, h] = known?.["1k"] || [x * scale, y * scale];
    const sizes =
      known && Object.fromEntries(Object.entries(known).map(([tier, [w, h]]) => [tier, { w, h }]));
    return { label, value: `${w}x${h}`, w, h, ...(sizes ? { sizes } : {}) };
  });
}
// Longest reference edge sent to the provider, which works at 1080p or 2k at most.
const referenceEdge = 2048;
interface ProfileOptions {
  provider: CliProxyMedia;
  workflows(): Value[];
  buildProfile(input: Value): Value;
  accountForOwner(id: string): Value | null;
  mayUseProfile(account: Value, profile: Value): boolean;
  reference(account: Value | null, id: string): Promise<Uint8Array>;
  composePrompt(workflow: Value, prompt: string): string;
  environment?: NodeJS.ProcessEnv;
}

/** Retains configured profile IDs while executing single Grok nodes directly. */
export function studioCloudProfiles(options: ProfileOptions) {
  const environment = options.environment || process.env;
  const supported = (workflow: Value) =>
    [workflow, ...(Object.values(workflow.imageModes || {}) as Value[])].every((mode) => {
      const nodes = Object.values(mode.graph || {}) as Value[];
      return nodes.length === 1 && nodes[0].class_type === "GrokMedia";
    });
  const workflowFor = (id: string) =>
    options.workflows().find((workflow) => workflow.profileId === id && supported(workflow));
  async function profiles(): Promise<Value[]> {
    const advertised = await options.provider.models();
    return options
      .workflows()
      .filter(supported)
      .flatMap((workflow) => {
        const node = Object.values(workflow.graph)[0] as Value;
        const kind = workflow.kind;
        const prefix = kind === "video" ? "grok-imagine-video" : "grok-imagine-image";
        const model =
          workflow.defaults.model ||
          node.inputs.model ||
          environment[`STUDIO_CLIPROXYAPI_${kind.toUpperCase()}_MODEL`] ||
          advertised.find((id) => id === prefix || id.startsWith(prefix + "-"));
        if (!advertised.includes(model)) return [];
        const configuredDefaults = Object.fromEntries(
          Object.entries(workflow.defaults).filter(([, value]) => value !== undefined),
        );
        // The graph's seed is only a placeholder: a draft starts on a random seed, as elsewhere.
        const { seed: _seed, ...inputs } = node.inputs;
        const defaults = {
          width: 1024,
          height: 1024,
          count: 1,
          duration: 6,
          ...inputs,
          ...configuredDefaults,
          model,
        };
        return [
          {
            ...options.buildProfile({
              ...workflow,
              id: workflow.profileId,
              label: workflow.name,
              model: workflow.profileId,
              baseModel: model,
              workflow: workflow.profileId,
              defaults,
              aspects: resolutions[model]?.length ? aspectPresets(model) : [],
              capabilities: { ...workflow.capabilities, inpaint: false, lora: false },
              // The model's own resolutions, which the size chip offers beside its aspects.
              options: {
                ...workflow.options,
                ...(resolutions[model]?.length ? { resolutions: resolutions[model] } : {}),
              },
              imageModes: workflow.imageModes,
            }),
            provider: "cliproxyapi",
            workerIds: [],
            familyName: "Grok",
          },
        ];
      });
  }
  async function resolve(job: Pick<OwnedJob, "input" | "ownerId">): Promise<CloudRequest> {
    const input = job.input as Value;
    const profile = (await profiles()).find((item) => item.id === modelOf(input));
    if (!profile)
      throw new Error("This cloud profile is unavailable from its configured provider.");
    const account = job.ownerId ? options.accountForOwner(job.ownerId) : null;
    if (job.ownerId && (!account || !options.mayUseProfile(account, profile)))
      throw Object.assign(new Error("This account cannot use the selected cloud profile."), {
        status: 403,
      });
    const references = (input.referenceAssets || []).filter((item: Value) => item.assetId);
    const referenceId = references[0]?.assetId;
    const workflow = workflowFor(profile.id)!;
    const selectedMode = workflow.imageModes?.[referenceId ? "reference" : "generate"] || workflow;
    const defaults = {
      ...profile.defaults,
      ...Object.fromEntries(
        Object.entries(selectedMode.defaults || {}).filter(([, value]) => value !== undefined),
      ),
    };
    const model = await options.provider.select(
      profile.kind,
      selectedMode.defaults?.model || profile.baseModel,
    );
    if (references.length > 1) throw new Error("This cloud provider accepts one reference image.");
    if (input.inpaint) throw new Error("This cloud profile does not support masking.");
    if (input.loras?.some((item: Value) => item.enabled !== false))
      throw new Error("This cloud profile does not support LoRAs.");
    if (input.autoUpscale) throw new Error("Run Upscale after this cloud generation finishes.");
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw new Error("Enter a prompt.");
    const count = Number(input.count ?? defaults.count);
    if (!Number.isInteger(count) || count < 1 || count > 8)
      throw new Error("Choose between one and eight image outputs.");
    const duration = Number(input.duration ?? defaults.duration);
    if (profile.kind === "video" && (!Number.isInteger(duration) || duration < 1 || duration > 15))
      throw new Error("Video duration must be between 1 and 15 seconds.");
    let reference: Uint8Array | undefined;
    if (referenceId) reference = await options.reference(account, referenceId);
    let width = Number(input.width ?? defaults.width);
    let height = Number(input.height ?? defaults.height);
    if (reference) {
      const { data, info } = await sharp(reference)
        .rotate()
        .resize(referenceEdge, referenceEdge, { fit: "inside", withoutEnlargement: true })
        // JPEG keeps the inline request under Grok's body limit, which a 2048 px PNG exceeds.
        .jpeg({ quality: 90 })
        .toBuffer({ resolveWithObject: true });
      reference = data;
      // A first frame gives the video its shape.
      if (profile.kind === "video") ({ width, height } = info);
    }
    let resolution = String(input.resolution ?? defaults.resolution ?? "");
    const allowed = resolutions[model];
    if (allowed?.length) {
      resolution ||=
        profile.kind === "video" ? "720p" : Math.max(width, height) > 1024 ? "2k" : "1k";
      if (!allowed.includes(resolution))
        throw new Error(`${model} supports ${allowed.join(", ")} resolution, not ${resolution}.`);
    } else if (allowed && resolution) throw new Error(`${model} has no resolution setting.`);
    return {
      kind: profile.kind,
      model,
      prompt: options.composePrompt(selectedMode, prompt),
      width,
      height,
      duration,
      resolution,
      count,
      ...(reference ? { reference } : {}),
    };
  }
  return {
    profiles,
    resolve,
    isProfile: (input: GenerationInput) => Boolean(workflowFor(modelOf(input))),
  };
}
