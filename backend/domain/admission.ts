import type { GenerationInput, GenerationOperation, QueueMedia } from "../../shared/queue.ts";
import { GenerationQueue } from "./queue.ts";
import { RewriteStore, type QueueOrigin } from "./store.ts";

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
  jobLimit: number;
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
    if (
      scope?.parentJobId &&
      options.store.job(ownerId, scope.parentJobId)?.sessionId !== scope.sessionId
    )
      return { status: 400, payload: { error: "Parent generation must belong to this session." } };
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
        const session =
          scopedSession ||
          options.store.createSession(
            ownerId,
            String(input.prompt || "Generation").slice(0, 100),
            input,
          );
        try {
          job = options.store.enqueue(
            ownerId,
            session.id,
            input,
            scope?.operation || (input.kind === "video" ? "animate" : "image"),
            scope?.parentJobId,
            await options.resourceFor(input),
            clientId || undefined,
            account?.role === "user" ? options.jobLimit : undefined,
            origin,
          );
        } catch (error) {
          const failure = error as Error & { code?: string; status?: number; reason?: string };
          if (failure.status === 429)
            return {
              status: 429,
              payload: { ok: false, reason: failure.reason, error: failure.message },
            };
          if (String(failure.code || "").startsWith("ERR_SQLITE"))
            return {
              status: 409,
              payload: { ok: false, error: "That generation ID is already in use." },
            };
          throw error;
        }
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
