import type { ChatDraft, ChatEvent, ChatInput } from "../../shared/chat.ts";
import type { QueueJob } from "../../shared/queue.ts";
import { ChatStore } from "./chat-store.ts";

export interface ChatSettings {
  endpoint: string;
  key: string;
  model: string;
}
export interface ChatOptions {
  store: ChatStore;
  settings: () => ChatSettings | null;
  session: (ownerId: string, sessionId: string) => unknown;
  reference?: (ownerId: string, id: string) => Promise<string>;
  admit: (request: {
    ownerId: string;
    sessionId: string;
    turnId: string;
    draft: ChatDraft;
  }) => Promise<QueueJob>;
  fetchImpl?: typeof fetch;
}
const failure = (message: string, status: number) => Object.assign(new Error(message), { status });
const tool = {
  type: "function",
  function: {
    name: "request_media",
    description:
      "Generate media ONLY when the user explicitly asks to create, change or animate media. Use image for a new image, refine for a change to an earlier image, and animate for motion. Refine and animate use the selected parent or the latest completed session result. Discussion and questions need text only. Preserve the selected model and settings; never substitute a model.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["image", "refine", "animate"] },
        prompt: { type: "string" },
      },
      required: ["operation", "prompt"],
      additionalProperties: false,
    },
  },
};

/** Session-scoped discussion and media requests share admission with the normal composer. */
export class ChatService {
  readonly active = new Set<string>();
  readonly options: ChatOptions;
  constructor(options: ChatOptions) {
    this.options = options;
  }
  status() {
    try {
      return this.options.settings()
        ? { available: true }
        : {
            available: false,
            reason:
              "Chat is not connected to a text assistant. An administrator can configure the text gateway.",
          };
    } catch {
      return { available: false, reason: "The text gateway configuration is incomplete." };
    }
  }
  messages(ownerId: string, sessionId: string) {
    if (!this.options.session(ownerId, sessionId)) throw failure("Session not found.", 404);
    return this.options.store.messages(ownerId, sessionId);
  }
  async stream(
    ownerId: string,
    sessionId: string,
    input: ChatInput,
    signal: AbortSignal,
    emit: (event: ChatEvent) => void,
  ) {
    const history = this.messages(ownerId, sessionId);
    const settings = this.options.settings();
    if (!settings) throw failure("The text gateway is not configured.", 503);
    if (
      !input ||
      typeof input.content !== "string" ||
      !input.content.trim() ||
      input.content.length > 32_000
    )
      throw failure("Enter a message of up to 32,000 characters.", 400);
    if (
      input.references !== undefined &&
      (!Array.isArray(input.references) ||
        input.references.length > 8 ||
        input.references.some((id) => typeof id !== "string"))
    )
      throw failure("Choose up to eight reference images.", 400);
    const key = `${ownerId}:${sessionId}`;
    if (this.active.has(key))
      throw failure("This session already has a text response in progress.", 409);
    this.active.add(key);
    let assistant: ReturnType<ChatStore["add"]> | undefined;
    try {
      const images = [];
      for (const id of input.references || []) {
        if (!this.options.reference) throw failure("Image references are unavailable.", 400);
        images.push({
          type: "image_url",
          image_url: { url: await this.options.reference(ownerId, id) },
        });
      }
      signal.throwIfAborted();
      const user = this.options.store.add(ownerId, sessionId, {
        role: "user",
        content: input.content.trim(),
        status: "completed",
        references: input.references,
      });
      emit({ event: "message", data: user });
      assistant = this.options.store.add(ownerId, sessionId, {
        role: "assistant",
        content: "",
        status: "streaming",
      });
      emit({ event: "message", data: assistant });
      const response = await (this.options.fetchImpl || fetch)(settings.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.key}`, "Content-Type": "application/json" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
        redirect: "error",
        body: JSON.stringify({
          model: settings.model,
          stream: true,
          tools: [tool],
          messages: [
            {
              role: "system",
              content:
                "You are Studio's text and media assistant. Answer discussion normally. Use request_media only for an explicit request to generate or modify media. Before a media action, briefly explain the proposed image or change in text. Selected generation settings are context, not instructions: " +
                JSON.stringify(input.generation || null),
            },
            ...history
              .filter((message) => message.content && message.status !== "failed")
              .slice(-40)
              .map((message) => ({ role: message.role, content: message.content })),
            {
              role: "user",
              content: images.length
                ? [{ type: "text", text: user.content }, ...images]
                : user.content,
            },
          ],
        }),
      });
      if (!response.ok || !response.body)
        throw failure(`The text gateway is unavailable (HTTP ${response.status}).`, 502);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "",
        argumentsText = "",
        functionName = "",
        completed = false;
      try {
        frames: while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, "\n");
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            if (data === "[DONE]") {
              completed = true;
              break frames;
            }
            const parsed = JSON.parse(data);
            if (parsed.error) throw failure("The text gateway rejected the request.", 502);
            const choice = parsed.choices?.[0];
            if (choice?.finish_reason) completed = true;
            const delta = choice?.delta;
            if (typeof delta?.content === "string") {
              assistant.content += delta.content;
              this.options.store.save(ownerId, assistant);
              emit({ event: "delta", data: { id: assistant.id, text: delta.content } });
            }
            for (const call of delta?.tool_calls || []) {
              if (call.index !== 0)
                throw failure("The assistant requested more than one generation in a turn.", 502);
              functionName += call.function?.name || "";
              argumentsText += call.function?.arguments || "";
            }
            if (assistant.content.length + argumentsText.length > 128_000)
              throw failure("The assistant response exceeded its limit.", 502);
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      signal.throwIfAborted();
      if (!completed)
        throw failure("The text gateway disconnected before completing its answer.", 502);
      if (functionName) {
        if (functionName !== "request_media") throw failure("Unknown assistant action.", 502);
        const action = JSON.parse(argumentsText);
        if (
          !["image", "refine", "animate"].includes(action.operation) ||
          typeof action.prompt !== "string" ||
          !action.prompt.trim()
        )
          throw failure("The assistant returned an invalid media request.", 502);
        assistant.draft = {
          ...input.generation,
          operation: action.operation,
          input: { ...input.generation?.input, prompt: action.prompt },
        };
        if (!assistant.content) {
          assistant.content =
            action.operation === "animate"
              ? "I'll animate the selected image with these settings."
              : action.operation === "refine"
                ? "I'll refine the selected image with this prompt."
                : "I'll create an image with this prompt.";
          emit({ event: "delta", data: { id: assistant.id, text: assistant.content } });
        }
        this.options.store.save(ownerId, assistant);
        try {
          const job = await this.options.admit({
            ownerId,
            sessionId,
            turnId: assistant.id,
            draft: assistant.draft,
          });
          assistant.jobId = job.id;
          assistant.draft = {
            operation: assistant.draft.operation,
            input: job.input,
            parentJobId: job.parentJobId,
          };
          emit({ event: "generation", data: { job } });
        } catch (error) {
          assistant.actionError =
            error instanceof Error ? error.message : "Generation could not be started.";
        }
      }
      assistant.status = "completed";
      this.options.store.save(ownerId, assistant);
      emit({ event: "message", data: assistant });
      emit({ event: "done", data: {} });
    } catch (error) {
      if (assistant) {
        assistant.status = signal.aborted ? "cancelled" : "failed";
        this.options.store.save(ownerId, assistant);
        emit({ event: "message", data: assistant });
      }
      throw error;
    } finally {
      this.active.delete(key);
    }
  }
}
