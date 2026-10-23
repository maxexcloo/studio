import sharp from "sharp";
import type { GenerationInput } from "../../shared/queue.ts";
import type { OwnedJob } from "../domain/store.ts";
import { CliProxyMedia, type CloudRequest } from "./cliproxy.ts";

type Value = Record<string, any>;
interface ProfileOptions {
  provider: CliProxyMedia;
  workflows(): Value[];
  buildProfile(input: Value): Value;
  accountForOwner(id: string): Value | null;
  mayUseProfile(account: Value, profile: Value): boolean;
  mayUseFeature(account: Value, feature: string): boolean;
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
        const defaults = {
          width: 1024,
          height: 1024,
          count: 1,
          duration: 6,
          ...node.inputs,
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
              aspects: [],
              capabilities: { ...workflow.capabilities, inpaint: false, lora: false },
              options: workflow.options,
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
    const profile = (await profiles()).find((item) => item.id === (input.profileId || input.model));
    if (!profile)
      throw new Error("This cloud profile is unavailable from its configured provider.");
    const account = job.ownerId ? options.accountForOwner(job.ownerId) : null;
    const feature = profile.kind === "video" ? "videoGeneration" : "imageGeneration";
    if (
      job.ownerId &&
      (!account ||
        !options.mayUseProfile(account, profile) ||
        !options.mayUseFeature(account, feature))
    )
      throw Object.assign(new Error("This account cannot use the selected cloud profile."), {
        status: 403,
      });
    const references = (input.referenceAssets || []).filter((item: Value) => item.assetId);
    const referenceId = references[0]?.assetId || input.startImageId;
    const workflow = workflowFor(profile.id)!;
    const selectedMode =
      workflow.imageModes?.[referenceId || input.startImage ? "reference" : "generate"] || workflow;
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
    if (
      (referenceId || input.startImage) &&
      job.ownerId &&
      !options.mayUseFeature(
        account!,
        profile.kind === "video" ? "videoReferences" : "imageReferences",
      )
    )
      throw Object.assign(new Error("References are not enabled for this account."), {
        status: 403,
      });
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
    else if (input.startImage)
      reference = Buffer.from(String(input.startImage).split(",")[1], "base64");
    if (reference) reference = await sharp(reference).png().toBuffer();
    const width = Number(input.width ?? defaults.width);
    const height = Number(input.height ?? defaults.height);
    let resolution = String(input.resolution ?? defaults.resolution ?? "");
    // Match the existing bridge's defaults; discovery does not publish resolution schemas.
    if (!resolution && model === "grok-imagine-image-2.0")
      resolution = Math.max(width, height) > 1024 ? "2k" : "1k";
    if (!resolution && ["grok-imagine-video", "grok-imagine-video-1.5"].includes(model))
      resolution = "720p";
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
    isProfile: (input: GenerationInput) =>
      Boolean(workflowFor(String(input.profileId || input.model || ""))),
  };
}
