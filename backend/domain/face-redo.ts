import type { GenerationInput } from "../../shared/queue.ts";
import type { DomainResponse, GenerationAccount, GenerationScope } from "./admission.ts";
import type { Identity } from "./face-check.ts";
import { queuePriority, type OwnedJob, type QueueOrigin } from "./store.ts";

/**
 * Only results this recent are redone, so the first check of an older gallery (Face Check turned
 * on, or a pass over results from before the redo) never floods the queue.
 */
export const faceRedoWindowMs = 24 * 60 * 60 * 1000;

/** A drifted gallery result, as Face Check read it. */
export interface DriftedItem {
  id: string;
  jobId?: string;
  ownerId?: string;
  createdAt?: string;
  dream?: unknown;
  uploaded?: boolean;
}

/**
 * The automatic redo: a result Face Check finds drifted (someone else's face, or the character
 * twice) runs once more as Run Again would, with a new seed, as a version of the drifted result in
 * its session. Each original is redone once; a redo is never redone. It queues at the account's own
 * tier, behind the work the person already queued: the redo replaces the image they asked for, so it
 * should not wait below Dream's and finishing's optional work.
 */
export function createFaceRedo(options: {
  enabled(): boolean;
  /** The owner's account to queue as; null once it is gone or disabled (undefined in single-user mode). */
  account(ownerId: string): GenerationAccount | null | undefined;
  job(ownerId: string, jobId: string): OwnedJob | undefined;
  jobsSince(ownerId: string, since: string): OwnedJob[];
  admit(
    input: GenerationInput,
    account: GenerationAccount | undefined,
    scope: GenerationScope,
    origin: QueueOrigin,
  ): Promise<DomainResponse>;
  now?: () => number;
  log?: { info(message: string): void };
}) {
  const { now = Date.now, log = console } = options;
  // Admission awaits validation, so an item checked twice at once queues one redo.
  const pending = new Set<string>();
  /** Queues the redo of `item`; resolves to its job ID, or undefined when there is none to queue. */
  return async function redo(item: DriftedItem, identity: Identity): Promise<string | undefined> {
    if (!options.enabled() || !identity.drifted || !identity.characterId) return;
    if (item.dream || item.uploaded || !item.jobId || pending.has(item.id)) return;
    if (!(now() - Date.parse(item.createdAt || "") < faceRedoWindowMs)) return;
    const ownerId = item.ownerId || "";
    const job = options.job(ownerId, item.jobId);
    if (!job || job.faceRedo || job.priority === queuePriority.dream || job.operation === "upscale")
      return;
    // A redo of the item is queued after it was made.
    if (
      options
        .jobsSince(ownerId, item.createdAt!)
        .some((other) => other.faceRedo && other.parentItemId === item.id)
    )
      return;
    const account = options.account(ownerId);
    if (account === null) return;
    // The run's own input, as Run Again sends it: a new seed, one image, and the prompt it ran with.
    const {
      clientJobId: _id,
      writing: _writing,
      resultSet: _set,
      ...input
    } = job.input as GenerationInput & Record<"clientJobId" | "writing" | "resultSet", unknown>;
    pending.add(item.id);
    try {
      const admitted = await options.admit(
        { ...input, seed: "", count: 1 },
        account,
        {
          sessionId: job.sessionId,
          operation: job.operation,
          parentJobId: job.id,
          parentItemId: item.id,
        },
        { priority: queuePriority.manual, faceRedo: true },
      );
      // A profile the account may no longer use, or one that is gone, refuses it here.
      if (admitted.status >= 400) {
        log.info(
          `Face redo of ${item.id} not queued: ${String(admitted.payload.error || admitted.status)}`,
        );
        return;
      }
      return String(admitted.payload.jobId);
    } finally {
      pending.delete(item.id);
    }
  };
}
