import { generationRecord } from "./generation-record.js";
import { cloudJobExpired, cloudJobFailedMessage, cloudJobLostMessage } from "./cloud-jobs.js";

/** When ComfyUI's history says a run started and ended (ms), from its status messages. */
export function historyRunTimes(entry) {
  const messages = Array.isArray(entry?.status?.messages) ? entry.status.messages : [];
  const at = (type) => {
    const value = Number(
      messages.find((message) => Array.isArray(message) && message[0] === type)?.[1]?.timestamp,
    );
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  return {
    startAt: at("execution_start"),
    endAt: at("execution_success") ?? at("execution_error") ?? at("execution_interrupted"),
  };
}

const tileFields = [
  "createdAt",
  "prompt",
  "negative",
  "model",
  "width",
  "height",
  "settings",
  "referenceImage",
  "referenceImageName",
  "startImageId",
  "assistant",
  "ownerId",
];

/**
 * A recovered output keeps what its pending tile knew: its place in the job (index), when it was asked for,
 * its settings and references, and how long it took, from the run's own start and end in ComfyUI's history.
 * Without the index MCP and signed result links cannot find it; without the times the record shows no elapsed time.
 */
export function restoreRecoveredRecords(outputs, tiles = [], entry = {}, promptId = "") {
  const { startAt, endAt } = historyRunTimes(entry);
  return outputs.map((output, position) => {
    const tile = tiles[position] || tiles[0] || {};
    const createdMs = Date.parse(tile.createdAt || "") || null;
    const runMs = startAt && endAt && endAt > startAt ? Math.round(endAt - startAt) : 0;
    const durationMs =
      endAt && createdMs && endAt > createdMs ? Math.round(endAt - createdMs) : runMs;
    const queueMs =
      startAt && createdMs && startAt >= createdMs ? Math.round(startAt - createdMs) : null;
    // The tile is Studio's own record of the request, so where it says something it wins over what the graph suggests.
    const kept = Object.fromEntries(
      tileFields
        .filter(
          (key) =>
            tile[key] !== undefined && tile[key] !== null && tile[key] !== "" && tile[key] !== 0,
        )
        .map((key) => [key, tile[key]]),
    );
    return {
      ...output,
      ...kept,
      index: Number.isInteger(output.index)
        ? output.index
        : Number.isInteger(tiles[position]?.index)
          ? tiles[position].index
          : position,
      ...(durationMs ? { durationMs } : {}),
      ...(runMs && !output.timing
        ? { timing: { runMs, ...(queueMs !== null ? { queueMs } : {}) } }
        : {}),
      ...(promptId && !output.promptId ? { promptId } : {}),
    };
  });
}

// Reattach persisted tiles to their existing prompts; never submit replacement work.
export function createJobRecovery({
  backends,
  finishJob,
  getGallery,
  jobs,
  recordsFromHistory,
  request,
  setGallery,
  visible,
  withBackend,
  ingest = async (records) => records,
}) {
  let active;
  const missing = new Map();
  // A job its runner (jobs.js) is still following: progress, delivery and timing are the runner's.
  const runnerOwned = (id) => {
    const current = jobs.get(id);
    return Boolean(current && !current.recovered && !current.terminalAt);
  };
  const candidateIds = () =>
    new Set(
      visible(
        getGallery().filter(
          (item) =>
            !item.url &&
            (["pending", "error"].includes(item.status) ||
              (item.status === "canceled" && jobs.get(item.jobId)?.recovered)),
        ),
      )
        .map((item) => item.jobId)
        .filter(Boolean),
    );
  /** Only the job's own tiles are compared: the whole gallery can be tens of megabytes of JSON. */
  function patchTiles(id, patch) {
    let changed = false;
    const next = getGallery().map((item) => {
      if (item.jobId !== id || item.url) return item;
      const patched = patch(item);
      if (JSON.stringify(patched) === JSON.stringify(item)) return item;
      changed = true;
      return patched;
    });
    if (changed) setGallery(next);
  }
  async function recover() {
    if (
      !getGallery().some(
        (item) => !item.url && ["pending", "error", "canceled"].includes(item.status),
      )
    )
      return;
    const untracked = new Set(
      visible(
        getGallery().filter(
          (item) =>
            !item.url && ["pending", "error"].includes(item.status) && !jobs.has(item.jobId),
        ),
      )
        .map((item) => item.jobId)
        .filter(Boolean),
    );
    // While every unfinished tile belongs to a job its runner follows (any long video), there is nothing to recover:
    // asking each worker for its queue and 500 history entries every few seconds only slows a busy worker down.
    if (!untracked.size && [...candidateIds()].every(runnerOwned)) return;
    const configured = backends();
    let scanned = 0;
    for (const backend of configured) {
      await withBackend(backend, async () => {
        // Recovered jobs whose prompts are known are looked up one by one; only an unknown prompt needs the history list.
        const prompts = [...candidateIds()]
          .filter(
            (id) =>
              !runnerOwned(id) &&
              (!jobs.get(id)?.comfyBackend || jobs.get(id).comfyBackend === backend),
          )
          .map((id) => jobs.get(id)?.promptId);
        const listed = untracked.size > 0 || prompts.some((promptId) => !promptId);
        // Both must answer before a missing prompt can count as lost.
        const [queue, history] = await Promise.all([
          request("/queue", { timeout: 10000 }),
          listed
            ? request("/history?max_items=500", { timeout: 15000 })
            : Promise.all(
                prompts.map((promptId) =>
                  request(`/history/${encodeURIComponent(promptId)}`, { timeout: 15000 }),
                ),
              ).then((answers) =>
                Object.assign(
                  {},
                  ...answers.map((answer) => (answer && typeof answer === "object" ? answer : {})),
                ),
              ),
        ]);
        const places = new Map();
        for (const [key, status] of [
          ["queue_running", "running"],
          ["queue_pending", "queued"],
        ]) {
          for (const entry of queue[key] || []) {
            const id = generationRecord(entry[3]).jobId;
            if (id) places.set(id, { promptId: entry[1], status });
          }
        }
        const completed = new Map();
        for (const [promptId, entry] of Object.entries(history)) {
          const id = generationRecord(entry.prompt?.[3]).jobId;
          if (id) completed.set(id, { entry, promptId });
        }
        const candidates = candidateIds();
        for (const id of candidates) {
          // Its runner reports its progress and delivers it; a second writer only races it.
          if (runnerOwned(id)) continue;
          const current = jobs.get(id);
          if (current?.comfyBackend && current.comfyBackend !== backend) continue;
          const place = places.get(id);
          if (current?.recovered && ["canceling", "canceled"].includes(current.status)) {
            if (!place) finishJob(id, { status: "canceled" });
            continue;
          }
          if (place && !["canceling", "canceled"].includes(current?.status)) {
            untracked.delete(id);
            missing.delete(id);
            const progress =
              place.status === "queued"
                ? { value: 0, max: 0, phase: "Queued", steps: false }
                : (current?.progress?.phase && current.progress.phase !== "Queued") ||
                    current?.progress?.max > 0
                  ? current.progress
                  : { value: 0, max: 0, phase: "Generating", steps: false };
            const ownerId =
              current?.ownerId || getGallery().find((item) => item.jobId === id)?.ownerId;
            // A run its runner gave up on (a worker too busy to answer) is followed from here on; its old end must not expire it mid-run.
            jobs.set(id, {
              ...current,
              ...place,
              ...(ownerId ? { ownerId } : {}),
              comfyBackend: backend,
              progress,
              ...(!current || current.terminalAt ? { recovered: true, terminalAt: undefined } : {}),
            });
            patchTiles(id, ({ failure: _failure, error: _error, ...item }) => ({
              ...item,
              status: "pending",
              progress,
            }));
            continue;
          }
          const done = completed.get(id);
          const tiles = getGallery()
            .filter((item) => item.jobId === id && !item.url)
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
          const restored = done
            ? restoreRecoveredRecords(
                visible(recordsFromHistory({ [done.promptId]: done.entry })),
                tiles,
                done.entry,
                done.promptId,
              )
            : [];
          // A run whose runner ended it (failed, or gave up on a busy worker) keeps the runner's reason unless ComfyUI did finish it.
          if (current && !current.recovered && !restored.length) continue;
          if (done) {
            untracked.delete(id);
            missing.delete(id);
            // With Studio media storage, recovered outputs move out of ComfyUI like delivered ones.
            const outputs = await ingest(restored, done.promptId);
            if (outputs.length) {
              const urls = new Set(
                getGallery()
                  .filter((item) => item.status === "done")
                  .map((item) => item.url),
              );
              setGallery([
                ...outputs.filter((item) => !urls.has(item.url)),
                ...getGallery().filter((item) => item.jobId !== id || item.url),
              ]);
              finishJob(id, {
                status: "done",
                outputs,
                comfyBackend: backend,
                promptId: done.promptId,
              });
            } else {
              const failed = done.entry.status?.status_str === "error";
              const error = failed
                ? current?.cloud
                  ? cloudJobFailedMessage
                  : "ComfyUI could not finish this generation."
                : "ComfyUI finished without an available output file.";
              setGallery(
                getGallery().map((item) =>
                  item.jobId === id && !item.url
                    ? { ...item, status: "error", error, progress: null }
                    : item,
                ),
              );
              finishJob(id, {
                status: "error",
                error,
                comfyBackend: backend,
                promptId: done.promptId,
              });
            }
          } else if (current?.recovered && current.comfyBackend) {
            const misses = (missing.get(id) || 0) + 1;
            missing.set(id, misses);
            // A cloud run past the provider's own deadline cannot reappear, so one confirmed miss settles it.
            const expired = current.cloud && cloudJobExpired(current);
            if (misses < 2 && !expired) continue;
            const status = ["canceling", "canceled"].includes(current.status)
              ? "canceled"
              : "error";
            const lost = current.cloud
              ? expired
                ? cloudJobFailedMessage
                : cloudJobLostMessage
              : "ComfyUI no longer has this generation.";
            const error = status === "error" ? lost : undefined;
            setGallery(
              getGallery().map((item) =>
                item.jobId === id ? { ...item, status, error, progress: null } : item,
              ),
            );
            finishJob(id, { status, error });
            missing.delete(id);
          }
        }
        scanned++;
      }).catch(() => {
        // An unavailable backend must not invalidate its persisted jobs or block the other backend.
      });
    }
    // An untracked tile has no backend identity; every backend must confirm absence.
    for (const id of untracked) {
      if (
        jobs.has(id) ||
        !visible(getGallery()).some(
          (item) => item.jobId === id && !item.url && ["pending", "error"].includes(item.status),
        )
      ) {
        missing.delete(id);
        continue;
      }
      if (!configured.length || scanned !== configured.length) {
        missing.delete(id);
        continue;
      }
      const misses = (missing.get(id) || 0) + 1;
      missing.set(id, misses);
      if (misses < 2) continue;
      const error = "ComfyUI no longer has this generation.";
      setGallery(
        getGallery().map((item) =>
          item.jobId === id && !item.url && ["pending", "error"].includes(item.status)
            ? { ...item, status: "error", error, progress: null }
            : item,
        ),
      );
      finishJob(id, { status: "error", error, recovered: true });
      missing.delete(id);
    }
  }
  return () =>
    active ||
    (active = recover().finally(() => {
      active = null;
    }));
}
