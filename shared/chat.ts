import type { GenerationInput, GenerationOperation } from "./queue.ts";
import type { QueueJob } from "./queue.ts";

export interface ChatDraft {
  operation: Exclude<GenerationOperation, "upscale">;
  input: GenerationInput;
  parentJobId?: string;
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
}
export interface ChatInput {
  content: string;
  references?: string[];
  generation?: ChatDraft;
}
export type ChatEvent =
  | { event: "message"; data: ChatMessage }
  | { event: "delta"; data: { id: string; text: string } }
  | { event: "done"; data: Record<string, never> }
  | { event: "generation"; data: { job: QueueJob } }
  | { event: "error"; data: { error: string } };
