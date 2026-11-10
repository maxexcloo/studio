import type { QueueJob as SharedQueueJob, StudioSession } from "../../shared/queue";
import type { Resolution } from "../../shared/resolution";
import type { UpscaleQuality } from "../../shared/upscale";
export type MediaKind = "image" | "video";
export interface Profile {
  id: string;
  label: string;
  displayName?: string;
  kind: MediaKind;
  model: string;
  workflow: string;
  family: string;
  familyName?: string;
  baseModel?: string;
  variantLabel?: string;
  recipe?: { modelLabel?: string; label?: string };
  workerIds?: string[];
  maxLoras?: number;
  provider?: string;
  ready?: boolean;
  uncensored?: boolean;
  /** Drafted by the assistant and not yet approved; only administrators see it. */
  aiDrafted?: boolean;
  /** Most of its runs in the last week failed (backend stats.js). */
  failing?: boolean;
  /** Merged profile ids that now resolve to this one; older records may still name them. */
  aliases?: string[];
  /** The backend each merged per-backend id ran on, so reruns of its records keep it. */
  aliasBackends?: Record<string, string>;
  /** A combined profile: the backend it runs on now, and every backend it has. */
  backend?: string;
  backendOptions?: { id: string; label: string; ready?: boolean; reason?: string }[];
  /** Why it isn't ready, such as its backend's missing nodes. */
  readyReason?: string;
  defaults: Record<string, string | number>;
  capabilities: Record<string, boolean>;
  /** What a workflow's text-to-image and with-reference modes change (`defaults` is `generate`'s). */
  imageModes?: Partial<
    Record<
      "generate" | "reference",
      { defaults?: Record<string, string | number>; capabilities?: Record<string, boolean> }
    >
  >;
  mediaInputs?: {
    id: string;
    label?: string;
    required?: boolean;
    max?: number;
    role?: string;
    follows?: string;
  }[];
  options?: Record<string, string[]>;
  encoderSlots?: { slot: string; label: string; options: string[]; default: string }[];
  encoderBuiltIn?: boolean;
  aspectPolicy?: "manual" | "reference";
  constraints?: Record<string, { min?: number; max?: number; step?: number }>;
  aspectPresets?: { label: string; w: number; h: number }[];
  /** Output sizes the model draws itself: "yes" or "maybe" per 2K/4K. */
  native?: Partial<Record<"2k" | "4k", "yes" | "maybe">>;
  /** The family edits with its references; otherwise a reference is an img2img start image. */
  editReferences?: boolean;
}
export interface ReferenceAsset {
  id: string;
  slot?: string;
  source?: "upload" | "generation";
  /** The gallery item a generated reference came from. */
  galleryItemId?: string;
  name: string;
  thumbnailUrl: string;
  url?: string;
  width: number;
  height: number;
}
export interface GenerationInput extends Record<string, unknown> {
  kind: MediaKind;
  profileId: string;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: string | number;
  count: number;
  denoise: number;
  fps: number;
  frames: number;
  /** `triggers`: all the LoRA's trigger words (true or unset), none (false) or the ones listed. */
  loras: { name: string; strength: number; enabled: boolean; triggers?: boolean | string[] }[];
  referenceAssets: { slot: string; assetId: string }[];
  referenceDetails?: ReferenceAsset[];
  textEncoder?: string;
  textEncoders?: string[];
  weightDtype?: string;
  /** The size tier; width and height give only the shape where it applies (shared/resolution.ts). */
  resolutionTier?: Resolution;
  /** The backend a combined profile runs on; the profile's current one when absent. */
  profileBackend?: string;
}
export interface MediaItem {
  id: string;
  jobId?: string;
  /** Its place among the job's outputs; a saved result keeps its pending tile's place. */
  index?: number;
  url: string;
  thumbnailUrl?: string;
  preview?: string;
  type: MediaKind;
  width?: number;
  height?: number;
  status: string;
  prompt?: string;
  negative?: string;
  /** The prompt a provider's moderation refused; `prompt` is the assistant's softened retry. */
  refusedPrompt?: string;
  /** How the prompt assistant wrote the prompt in the queue: its text model and thinking. */
  writing?: { kind: string; model?: string; thinking?: string };
  /** A few words the text model summarised from the prompt; show it with mediaTitle. */
  title?: string;
  /** What the image shows, from Gallery Captions; older captions have no tags. */
  caption?: { text: string; tags?: string[]; model?: string; at?: string };
  /** A prompt that would recreate an item made without one (an upload); Recreate uses it. */
  suggestedPrompt?: string;
  createdAt?: string;
  favorite?: boolean;
  /** An uploaded image or video (references.js), listed under the gallery's Uploads filter. */
  uploaded?: boolean;
  /** Where an imported upload came from: its Reddit post's link and title. */
  source?: { url: string; title: string };
  settings?: Record<string, unknown>;
  model?: string;
  filename?: string;
  /** The saved file's name, for downloads. */
  outputName?: string;
  /** The Chat whose generation made this item. */
  sessionId?: string;
  /**
   * The MCP result set it belongs to: one generate call's id, title and asking client (`source`),
   * and this result's prompt position and own title (`variation`), when the chat gave one.
   */
  resultSet?: { id: string; title: string; index: number; variation?: string; source?: string };
  /** The result this one was made from, kept from its run (backend/version-sources.js `resultSource`). */
  parentItemId?: string;
  parentJobId?: string;
  /** Made from `parentItemId` but changed too much to be one of its versions (`isVersion`). */
  derived?: true;
  durationMs?: number;
  timing?: {
    runMs?: number;
    queueMs?: number;
    setupMs?: number;
    samplingMs?: number;
    finishMs?: number;
  };
  upscaleActive?: boolean;
  upscale?: {
    withRun?: boolean;
    url?: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    status?: string;
    outputName?: string;
    quality?: UpscaleQuality;
    faceDetail?: boolean;
    scale?: number;
    jobId?: string;
  };
}
export type QueueJob = Omit<SharedQueueJob, "input" | "items" | "outputs" | "progress"> & {
  input: GenerationInput;
  items: MediaItem[];
  outputs: MediaItem[];
  /** Generation steps, or while the prompt is written its streamed thinking and prompt. */
  progress?: { value?: number; max?: number; phase?: string; thinking?: string; prompt?: string };
};
export type Session = Omit<StudioSession, "inputs"> & { inputs: Partial<GenerationInput> };
export interface Account {
  id: string;
  username: string;
  role: "administrator" | "user";
  features?: Record<string, boolean>;
  accessProfileId?: string;
  accessProfile?: { name: string } | null;
  disabled?: boolean;
  signInLinked?: boolean;
  /** An administrator may set a new password: the account signs in with one. */
  passwordSignIn?: boolean;
  provider?: string;
  canChangeEmail?: boolean;
  canChangePassword?: boolean;
}
export interface Models {
  features?: { presets?: boolean };
  /** Each family's display name, from the catalogue. */
  familyLabels?: Record<string, string>;
  profiles: Profile[];
  defaults?: { imageModel?: string; videoModel?: string };
  workers?: {
    id: string;
    name: string;
    available: boolean;
    /** Not answering because its workloads were stopped on purpose. */
    parked?: boolean;
    /** The Studio workloads serving it, which an administrator can start. */
    workloads?: string[];
    capabilities: string[];
  }[];
}
