export type QueueStatus =
  | "writing"
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
/**
 * A generation whose prompt the prompt assistant writes as the queue item's first stage
 * (`input.writing`). The surface sets `kind` and its request; the stage adds the written `prompt`,
 * the `thinking` behind it and the text `model`, and the item then queues for generation.
 */
export interface PromptWriting {
  kind: "animate" | "request" | "dream";
  prompt?: string;
  thinking?: string;
  model?: string;
  /** The result's title, when the writer gave one with the prompt. */
  title?: string;
  [request: string]: unknown;
}
/** Whether an input still waits for its prompt to be written. */
export const awaitsWriting = (input: GenerationInput) => {
  const writing = input.writing as PromptWriting | undefined;
  return Boolean(writing && typeof writing === "object" && typeof writing.prompt !== "string");
};
export type QueueMedia = Record<string, unknown> & { id?: string; url?: string };

export interface StudioSession {
  id: string;
  title: string;
  /** Set once the title is generated or the user renames the chat; unset while it is New Chat. */
  titleSource?: "generated" | "user";
  /** Dream's own session: it holds Dream jobs and is never listed as a Chat. */
  hidden?: true;
  /** An MCP client's Chat; the conversation the client names (X-Studio-Conversation-Id) has one. */
  mcp?: { conversationId?: string };
  inputs: GenerationInput;
  createdAt: string;
  updatedAt: string;
}

export interface QueueJob {
  id: string;
  jobId: string;
  sessionId: string;
  parentJobId?: string;
  /** The parent job's result this run is a version of (Edit, Recreate, Animate and the like). */
  parentItemId?: string;
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

/** Settings › Maintenance › Unfinished Items: any account's job that has not finished. */
export interface UnfinishedJob extends QueueJob {
  ownerId: string;
  /** Dream's background work, outside the person's queue. */
  dream: boolean;
}
