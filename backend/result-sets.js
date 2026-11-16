// Variations of a selected image or its set, written by the queue's prompt stage.
import { directRoute } from "./domain/direct-route.ts";

const variations = 2;
const imagePrompt = (selected, source) =>
  selected.prompt || source.input.prompt || selected.settings?.typedPrompt;

/** The exact selected image, or a set's source lineage, with earlier variations for variety. */
export function setPrompts(store, job, item) {
  if (job.input.writing?.scope === "image") {
    const source = store.job(job.ownerId, job.parentJobId);
    const selected = item(job.ownerId, job.parentItemId);
    if (
      !source ||
      source.sessionId !== job.sessionId ||
      selected?.jobId !== source.id ||
      selected.type !== "image"
    )
      throw new Error("That source image is unavailable.");
    const prompt = imagePrompt(selected, source);
    if (!prompt?.trim()) throw new Error("That image has no source prompt.");
    return {
      source: prompt,
      ...(typeof selected.settings?.typedPrompt === "string" &&
      selected.settings.typedPrompt !== prompt
        ? { intent: selected.settings.typedPrompt }
        : {}),
      prompts: store
        .jobs(job.ownerId, job.sessionId)
        .filter(
          (other) =>
            other.parentItemId === selected.id &&
            other.input.writing?.scope === "image" &&
            other.input.prompt,
        )
        .map((other) => String(other.input.prompt)),
    };
  }
  const id = job.input.resultSet?.id;
  let source = job;
  const seen = new Set();
  while (source.input.writing?.kind === "set") {
    if (!source.parentJobId || seen.has(source.id))
      throw new Error("That result set's source is unavailable.");
    seen.add(source.id);
    source = store.job(job.ownerId, source.parentJobId);
    if (!source || source.sessionId !== job.sessionId || source.input.resultSet?.id !== id)
      throw new Error("That result set's source is unavailable.");
  }
  return {
    source: source.input.prompt,
    prompts: store
      .jobs(job.ownerId, job.sessionId)
      .filter(
        (other) =>
          other.input.resultSet?.id === id &&
          other.input.prompt &&
          other.input.prompt !== source.input.prompt,
      )
      .map((other) => String(other.input.prompt)),
  };
}

/**
 * `POST /api/result-sets/more` with `{ itemId }` queues two variations of the item's set, each with
 * its run's settings, into the set's session, after the set's last prompt. `scope: "image"`
 * anchors variations to that exact image instead, including images outside a result set. `item(ownerId, id)` is
 * the owner's visible gallery item; `admit` is domain/admission.ts's.
 */
export function registerResultSetRoutes(app, { store, admit, item }) {
  directRoute(app, "POST", "/api/result-sets/more", async (account, { body }) => {
    if (body?.scope !== undefined && !["image", "set"].includes(body.scope))
      return { status: 400, payload: { ok: false, error: "Choose image or set scope." } };
    const image = body?.scope === "image";
    const ownerId = account?.userId || "";
    const found = item(ownerId, String(body?.itemId || ""));
    const set = found?.resultSet;
    const job =
      found?.jobId && (image ? found.type === "image" && !found.uploaded : set)
        ? store.job(ownerId, found.jobId)
        : undefined;
    if (!job)
      return {
        status: 404,
        payload: {
          ok: false,
          error: image ? "That source image is unavailable." : "That result set is unavailable.",
        },
      };
    const members = set
      ? store.jobs(ownerId, job.sessionId).filter((other) => other.input.resultSet?.id === set.id)
      : [];
    const next =
      Math.max(-1, ...members.map((other) => Number(other.input.resultSet.index) || 0)) + 1;
    const {
      clientJobId: _id,
      writing: _writing,
      assistant: _assistant,
      resultSet: _set,
      ...input
    } = job.input;
    // Its character and chat context carry over; each new prompt is untitled.
    const { variation: _variation, ...kept } = set || {};
    if (image && !imagePrompt(found, job)?.trim())
      return { status: 400, payload: { ok: false, error: "That image has no source prompt." } };
    if (image) delete input.typedPrompt;
    const jobIds = [];
    for (let offset = 0; offset < variations; offset++) {
      const result = await admit(
        {
          ...input,
          prompt: "",
          seed: "",
          writing: { kind: "set", ...(image ? { scope: "image" } : {}) },
          ...(set ? { resultSet: { ...kept, index: next + offset } } : {}),
        },
        account,
        {
          sessionId: job.sessionId,
          operation: job.operation,
          parentJobId: job.id,
          parentItemId: found.id,
        },
      );
      if (result.status >= 400)
        return jobIds.length ? { status: 200, payload: { jobIds } } : result;
      jobIds.push(result.payload.jobId);
    }
    return { status: 200, payload: { jobIds } };
  });
}
