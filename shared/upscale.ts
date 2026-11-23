export const upscaleQualities = ["fast", "balanced", "high"] as const;
export type UpscaleQuality = (typeof upscaleQualities)[number];
type UpscaleTarget = 2048 | 4096;

export interface UpscaleRequest {
  galleryItemId: string;
  quality?: UpscaleQuality;
  target?: 0 | UpscaleTarget;
  faceDetail?: boolean;
}

export interface UpscaleStatus {
  ok: boolean;
  quality: UpscaleQuality;
  qualities: UpscaleQuality[];
  targets: UpscaleTarget[];
  ready: boolean;
  nodesInstalled: boolean;
  missingNodes: string[];
  missingModels: string[];
  substituting: boolean;
  fallbackFile: string;
  faceDetail: {
    nodesInstalled: boolean;
    missingNodes: string[];
    detectors: string[];
    samModels: string[];
    /** The catalogue download that installs a face detector, while none is installed. */
    download?: { id: string; label: string; bytes: number };
  };
}

export interface UpscaleResponse {
  ok: boolean;
  jobId: string;
  plan: {
    quality: UpscaleQuality;
    sourceWidth: number;
    sourceHeight: number;
    estimatedWidth: number;
    estimatedHeight: number;
    scale: number;
  };
  revision: number;
}
