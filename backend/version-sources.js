import { isVersion, resultInput } from "../shared/versions.ts";

/**
 * What a run's gallery results keep of the result it was made from, so they stay its versions once
 * the run leaves the queue or its Chat is deleted: that result (`parentItemId`), the run it came
 * from when the run joined that run's Chat, and `derived` when it changed too much to be one of its
 * versions (`isVersion`, against the parent run or else the saved source).
 */
export function resultSource(job, parentItemId, { parent, source } = {}) {
  const from = parent || { input: source ? resultInput(source) : {} };
  return {
    parentItemId,
    ...(job.parentJobId ? { parentJobId: job.parentJobId } : {}),
    ...(isVersion(job, from) ? {} : { derived: true }),
  };
}
