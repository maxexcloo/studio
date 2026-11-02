import type { GenerationInput, GenerationOperation } from "./queue.ts";

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
  /** Studio text workloads serving it, in start order; listed for administrators, who may start them. */
  workloads?: string[];
  /** For accounts that may not start workloads: every workload serving it was stopped on purpose. */
  parked?: boolean;
}
/** One tool call of a reply's agent loop, as the reply's tool trail shows it. */
export interface ChatStep {
  /** The model's tool call id. */
  id: string;
  /** The Studio MCP tool, such as Generate. */
  tool: string;
  input: Record<string, unknown>;
  status: "running" | "completed" | "failed";
  /** What the tool answered, shortened. */
  output?: string;
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
  /** The model's reasoning before its reply. */
  thinking?: string;
  status: "streaming" | "completed" | "cancelled" | "failed";
  createdAt: string;
  /** The tools the reply called, in order. */
  steps?: ChatStep[];
  references?: string[];
  draft?: ChatDraft;
  jobId?: string;
  actionError?: string;
  /** Why a failed reply stopped, as Studio said it at the time. */
  error?: string;
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
  | { event: "thinking"; data: { id: string; text: string } }
  | { event: "done"; data: Record<string, never> }
  | { event: "generation"; data: { jobIds: string[] } }
  | { event: "error"; data: { error: string } };
