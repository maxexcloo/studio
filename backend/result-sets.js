// More Like This Set: new variations queued into an MCP result set, each prompt written by the
// queue's writing stage (prompt-set.js) as the set's other prompts steer it.
import { directRoute } from "./domain/direct-route.ts";

const variations = 2;

/** The prompts an MCP result set holds so far, among its Chat's jobs, oldest first. */
export function setPrompts(store, job) {
  const id = job.input.resultSet?.id;
  return store
    .jobs(job.ownerId, job.sessionId)
    .filter((other) => other.input.resultSet?.id === id && other.input.prompt)
    .map((other) => String(other.input.prompt));
}

/**
 * `POST /api/result-sets/more` with `{ itemId }` queues two variations of the item's set, each with
 * its run's settings, into the set's Chat, after the set's last prompt. `item(ownerId, id)` is
 * the owner's visible gallery item; `admit` is domain/admission.ts's.
 */
export function registerResultSetRoutes(app, { store, admit, item }) {
  directRoute(app, "POST", "/api/result-sets/more", async (account, { body }) => {
    const ownerId = account?.userId || "";
    const found = item(ownerId, String(body?.itemId || ""));
    const set = found?.resultSet;
    const job = set && found.jobId ? store.job(ownerId, found.jobId) : undefined;
    if (!job)
      return { status: 404, payload: { ok: false, error: "That result set is unavailable." } };
    const members = store
      .jobs(ownerId, job.sessionId)
      .filter((other) => other.input.resultSet?.id === set.id);
    const next = Math.max(...members.map((other) => Number(other.input.resultSet.index) || 0)) + 1;
    const {
      clientJobId: _id,
      writing: _writing,
      assistant: _assistant,
      resultSet: _set,
      ...input
    } = job.input;
    const jobIds = [];
    for (let offset = 0; offset < variations; offset++) {
      const result = await admit(
        {
          ...input,
          prompt: "",
          seed: "",
          writing: { kind: "set" },
          resultSet: { id: set.id, title: set.title, source: set.source, index: next + offset },
        },
        account,
        { sessionId: job.sessionId, operation: job.operation },
      );
      if (result.status >= 400)
        return jobIds.length ? { status: 200, payload: { jobIds } } : result;
      jobIds.push(result.payload.jobId);
    }
    return { status: 200, payload: { jobIds } };
  });
}
