export type UpscaleQuality = "fast" | "balanced" | "high";
export type UpscaleTarget = 2048 | 4096;

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
