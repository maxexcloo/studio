import type { QueueJob as SharedQueueJob, StudioSession } from "../../shared/queue";
import type { UpscaleQuality } from "../../shared/upscale";
export type MediaKind = "image" | "video";
export interface Profile {
  id: string;
  label: string;
  displayName?: string;
  description?: string;
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
  nsfw?: boolean;
  defaults: Record<string, string | number>;
  capabilities: Record<string, boolean>;
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
}
export interface ReferenceAsset {
  id: string;
  slot?: string;
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
  loras: { name: string; strength: number; enabled: boolean }[];
  referenceAssets: { slot: string; assetId: string }[];
  referenceDetails?: ReferenceAsset[];
  textEncoder?: string;
  textEncoders?: string[];
  weightDtype?: string;
}
export interface MediaItem {
  id: string;
  jobId?: string;
  url: string;
  thumbnailUrl?: string;
  preview?: string;
  type: MediaKind;
  width?: number;
  height?: number;
  status: string;
  prompt?: string;
  negative?: string;
  createdAt?: string;
  favorite?: boolean;
  settings?: Record<string, unknown>;
  model?: string;
  filename?: string;
  /** The saved file's name, for downloads. */
  outputName?: string;
  /** The Chat whose generation made this item. */
  sessionId?: string;
  durationMs?: number;
  timing?: {
    runMs?: number;
    queueMs?: number;
    setupMs?: number;
    samplingMs?: number;
    finishMs?: number;
  };
  startImageId?: string;
  referenceImage?: string;
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
  progress?: { value: number; max: number; phase?: string };
};
export type Session = Omit<StudioSession, "inputs"> & { inputs: Partial<GenerationInput> };
export interface Account {
  id: string;
  username: string;
  displayName: string;
  role: "administrator" | "user";
  features?: Record<string, boolean>;
  accessProfileId?: string;
  accessProfile?: { name: string } | null;
  disabled?: boolean;
  pending?: boolean;
  signInLinked?: boolean;
  provider?: string;
  canChangeEmail?: boolean;
  canChangePassword?: boolean;
}
export interface Models {
  features?: { library?: boolean; presets?: boolean };
  profiles: Profile[];
  defaults?: { imageModel?: string; videoModel?: string };
  workers?: {
    id: string;
    name: string;
    available: boolean;
    capabilities: string[];
    gpuDevices?: string[];
  }[];
}
