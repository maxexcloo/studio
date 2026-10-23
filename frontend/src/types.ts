import type { QueueJob as SharedQueueJob, StudioSession } from "../../shared/queue";
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
    quality?: "fast" | "balanced" | "high";
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
