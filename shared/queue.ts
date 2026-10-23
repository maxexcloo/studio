export type QueueStatus =
  | "queued"
  | "waiting"
  | "starting"
  | "running"
  | "saving"
  | "completed"
  | "failed"
  | "cancelled";
export type GenerationOperation = "image" | "refine" | "animate" | "upscale";
export type GenerationInput = Record<string, unknown>;
export type QueueMedia = Record<string, unknown> & { id?: string; url?: string };

export interface StudioSession {
  id: string;
  title: string;
  inputs: GenerationInput;
  createdAt: string;
  updatedAt: string;
}

export interface QueueJob {
  id: string;
  jobId: string;
  sessionId: string;
  parentJobId?: string;
  operation: GenerationOperation;
  status: QueueStatus;
  reason: string;
  input: GenerationInput;
  items: QueueMedia[];
  outputs: QueueMedia[];
  progress?: Record<string, unknown>;
  providerJobId?: string;
  backend?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QueueCancelAllResponse {
  outcomes: { job: QueueJob; cancelRequested: boolean; error?: string }[];
}
