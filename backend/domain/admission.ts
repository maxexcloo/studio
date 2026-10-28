import type { GenerationInput, GenerationOperation, QueueMedia } from "../../shared/queue.ts";
import { referencedResult } from "../../shared/versions.ts";
import { GenerationQueue } from "./queue.ts";
import { queuePriority, RewriteStore, type OwnedJob, type QueueOrigin } from "./store.ts";

export type GenerationAccount = Record<string, unknown> & {
  userId: string;
  role: string;
  authenticated?: boolean;
};
export interface DomainResponse {
  status: number;
  payload: Record<string, unknown>;
}
export interface GenerationScope {
  sessionId: string;
  operation: Exclude<GenerationOperation, "upscale">;
  parentJobId?: string;
}
interface AdmissionOptions {
  store: RewriteStore;
  queue: GenerationQueue;
  validate(input: GenerationInput, account?: GenerationAccount): Promise<DomainResponse>;
  resourceFor(input: GenerationInput): Promise<string>;
  pendingItems(id: string, input: GenerationInput): QueueMedia[];
  revision(): number;
  /** Hears each newly queued job, for the taste profile; must not throw. */
  admitted?(job: OwnedJob): void;
}

/** HTTP and MCP share durable admission, identity, validation and idempotency. */
export function createGenerationAdmission(options: AdmissionOptions) {
  const locks = new Map<string, Promise<void>>();
  return async (
    input: GenerationInput,
    account?: GenerationAccount,
    scope?: GenerationScope,
    origin?: QueueOrigin,
  ): Promise<DomainResponse> => {
    if (account?.authenticated === false)
      return { status: 401, payload: { ok: false, error: "This account no longer has access." } };
    const ownerId = account?.userId || "";
    const scopedSession = scope && options.store.session(ownerId, scope.sessionId);
    if (scope && !scopedSession) return { status: 404, payload: { error: "Session not found." } };
    const parent = scope?.parentJobId ? options.store.job(ownerId, scope.parentJobId) : undefined;
    if (scope?.parentJobId && parent?.sessionId !== scope.sessionId)
      return { status: 400, payload: { error: "Parent generation must belong to this chat." } };
    const clientId = String(input.clientJobId || "").replace(/[^\w-]/g, "");
    let release: (() => void) | undefined;
    if (clientId) {
      while (locks.has(clientId)) await locks.get(clientId);
      locks.set(
        clientId,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
    }
    try {
      let job = clientId ? options.store.job(ownerId, clientId) : undefined;
      if (job && scope && job.sessionId !== scope.sessionId)
        return { status: 409, payload: { error: "That generation belongs to another session." } };
      if (!job) {
        const checked = await options.validate(input, account);
        if (checked.status >= 400) return checked;
        const title = String(input.prompt || "Generation").slice(0, 100);
        // MCP work (its queue tier) joins its conversation's Chat; other unscoped work gets its own.
        const session =
          scopedSession ||
          (origin?.priority === queuePriority.mcp
            ? options.store.mcpSession(
                ownerId,
                title,
                input,
                (input.chat as { conversationId?: string } | undefined)?.conversationId,
              )
            : options.store.createSession(ownerId, title, input));
        try {
          job = options.store.enqueue(
            ownerId,
            session.id,
            input,
            scope?.operation || (input.kind === "video" ? "animate" : "image"),
            scope?.parentJobId,
            await options.resourceFor(input),
            clientId || undefined,
            {
              ...origin,
              // A Chat run is made from its parent's result only when it uses it as its reference.
              parentItemId: parent && referencedResult(input, parent),
            },
          );
        } catch (error) {
          const failure = error as Error & { code?: string };
          if (String(failure.code || "").startsWith("ERR_SQLITE"))
            return {
              status: 409,
              payload: { ok: false, error: "That generation ID is already in use." },
            };
          throw error;
        }
        options.admitted?.(job);
      }
      void options.queue.tick().catch(() => undefined);
      const items = job.items.length
        ? job.items
        : options.pendingItems(job.id, { ...job.input, ownerId, createdAt: job.createdAt });
      return {
        status: 200,
        payload: { jobId: job.id, items, revision: options.revision(), sessionId: job.sessionId },
      };
    } finally {
      if (clientId) {
        locks.delete(clientId);
        release?.();
      }
    }
  };
}
