import { defaultWorkerId } from "./workers.js";
import { readJsonFile, removeJsonFile, writeJsonFile } from "./json-store.js";

/**
 * Cloud (provider-backed) runs that were accepted by ComfyUI, kept on disk until
 * they end. A Grok run takes minutes and the provider keeps working through a
 * Studio restart, so the restarted server must know the run is still live
 * (its owner, backend and ComfyUI prompt) instead of reporting it missing;
 * job-recovery.js then reattaches and delivers it.
 */

const cloudNodeTypes = new Set(["GrokMedia"]);
// Past this, the provider has given up (the Grok node polls for 15 minutes) and
// a run ComfyUI no longer reports cannot come back.
export const cloudJobExpiryMs = 20 * 60 * 1000;
export const cloudJobFailedMessage =
  "Couldn’t finish this cloud generation; the provider job failed or expired";
export const cloudJobLostMessage =
  "Couldn’t resume this cloud generation after the restart; ComfyUI no longer has it";

export const cloudJobExpired = (job, now = Date.now()) =>
  now - (Number(job?.submittedAt) || 0) > cloudJobExpiryMs;
export const isCloudGraph = (graph) =>
  Object.values(graph || {}).some((node) => cloudNodeTypes.has(node?.class_type));

export function createCloudJobStore(file) {
  let records = null;
  function load() {
    if (records) return records;
    try {
      const raw = readJsonFile(file);
      records = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      records = {};
    }
    return records;
  }
  function save() {
    try {
      if (Object.keys(records).length) writeJsonFile(file, records);
      else removeJsonFile(file);
    } catch (error) {
      console.warn(`[Studio] Couldn’t save cloud jobs: ${error.message}`);
    }
  }
  return {
    file,
    all: () => ({ ...load() }),
    remember(id, record) {
      load()[id] = { submittedAt: Date.now(), ...record };
      save();
    },
    forget(id) {
      if (!Object.hasOwn(load(), id)) return;
      delete records[id];
      save();
    },
    /**
     * After a restart: each run still waiting on its tile goes back into `jobs`
     * as a recovered run, so status checks see it running. A record whose tile
     * was delivered, cancelled or deleted meanwhile is dropped.
     */
    restore(jobs, { live = () => true } = {}) {
      const restored = [];
      let changed = false;
      for (const [id, record] of Object.entries(load())) {
        if (jobs.has(id)) continue;
        if (!live(id)) {
          delete records[id];
          changed = true;
          continue;
        }
        jobs.set(id, {
          status: "running",
          recovered: true,
          cloud: true,
          comfyBackend: record.comfyBackend || defaultWorkerId(),
          promptId: record.promptId,
          submittedAt: record.submittedAt,
          ...(record.ownerId ? { ownerId: record.ownerId } : {}),
          ...(record.kind ? { kind: record.kind } : {}),
          ...(record.profileId ? { profileId: record.profileId } : {}),
          progress: { value: 0, max: 0, phase: "Generating", steps: false },
        });
        restored.push(id);
      }
      if (changed) save();
      return restored;
    },
  };
}
