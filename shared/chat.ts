import type { GenerationInput, GenerationOperation } from "./queue.ts";
import type { QueueJob } from "./queue.ts";

export interface ChatDraft {
  operation: Exclude<GenerationOperation, "upscale">;
  input: GenerationInput;
  parentJobId?: string;
}
export interface ChatRevision {
  sourceJobId: string;
  operation: ChatDraft["operation"];
  input: GenerationInput;
  changes?: Record<string, { before: unknown; after: unknown }>;
}
export interface ChatModel {
  id: string;
  label: string;
  provider?: string;
}
export interface ChatStatus {
  available: boolean;
  reason?: string;
  models: ChatModel[];
  defaultModelId?: string;
}
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "completed" | "cancelled" | "failed";
  createdAt: string;
  references?: string[];
  draft?: ChatDraft;
  jobId?: string;
  actionError?: string;
  revision?: ChatRevision;
  modelId?: string;
  actualModelId?: string;
  provider?: string;
}
export interface ChatInput {
  content: string;
  references?: string[];
  generation?: ChatDraft;
  revision?: ChatRevision;
  modelId?: string;
}
export type ChatEvent =
  | { event: "message"; data: ChatMessage }
  | { event: "delta"; data: { id: string; text: string } }
  | { event: "done"; data: Record<string, never> }
  | { event: "generation"; data: { job: QueueJob } }
  | { event: "error"; data: { error: string } };
