import crypto from "node:crypto";

import { activeStatuses, pendingStatuses } from "../shared/queue.ts";
import { getCustomWorkflow } from "./custom-workflows.js";
import { everyone } from "./domain/store.ts";
import { radianceImageNode, radianceVideoNode } from "./providers/radiance.ts";
import { isRadianceWorker, listWorkers } from "./workers.js";
import { resolveImageMode } from "./workflow-modes.js";

// Exact migration values, never runtime aliases. Profiles are versioned separately by administrators.
const models = {
  "fasth3-8-step-v2-fp8.rad": "fasth3-8-step-v2-i8",
  "flux-3-klein-base-fp8.rad": "flux-3-image-klein-base-iq8r",
  "flux-3-klein-fp8.rad": "flux-3-image-klein-iq8r",
  "krea-2-turbo-fp8.rad": "krea-2-turbo-iq8r",
  "kroma-0.3.1-turbo-fp8.rad": "kroma-v0.3.1-turbo-iq8r",
  "kromafine-1-turbo-fp8.rad": "kromafine-turbo-v1.0-iq8r",
  "minimax-h3-fp8.rad": "minimax-h3-i8",
  "noctq-v4-uncensored-fp8.rad": "noctq-v4-iq8r",
  "qwen-image-2.1-fp8.rad": "qwen-image-2.1-iq8r",
  "qwen-image-2.1-turbo-fp8.rad": "qwen-image-2.1-turbo-iq8r",
};

const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );

/** Synchronous under a global dispatch hold: no provider calls, no new job identities or profile edits. */
export function migrateRadianceQueue(store, options = {}) {
  if (!options.apply) return plan(store, options);
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const result = plan(store, options);
    store.db.exec("COMMIT");
    return result;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}

function plan(
  store,
  { apply = false, baseHash = "", workers = listWorkers(), profile = getCustomWorkflow } = {},
) {
  const open = store.openJobs();
  const hash = crypto.createHash("sha256").update(canonical(open)).digest("hex");
  const conflicts = [];
  if (!store.pauses().has(everyone))
    conflicts.push("Hold dispatch for every account before migrating waiting jobs.");
  if (open.some((job) => activeStatuses.has(job.status) || job.providerJobId))
    conflicts.push("Finish all accepted jobs before migrating waiting jobs.");
  const plans = [];
  for (const job of open.filter((item) => pendingStatuses.has(item.status))) {
    if (job.cancelRequested || store.providerRecord(job.ownerId, job.id)) {
      conflicts.push(`${job.id}: cancellation is still pending.`);
      continue;
    }
    if (job.operation === "upscale" || !job.resource.startsWith("worker:")) continue;
    const selected = profile(job.input.workflow || job.input.profileId, job.input.profileBackend);
    if (!selected) {
      conflicts.push(`${job.id}: its exact profile is unavailable.`);
      continue;
    }
    const resolved = resolveImageMode(selected, job.input);
    const node = Object.values(resolved.graph || {}).find((item) =>
      [radianceImageNode, radianceVideoNode].includes(item.class_type),
    );
    if (!node) continue;
    const input = { ...job.input };
    const changes = {};
    for (const field of ["model", "modelName"]) {
      const value = input[field];
      if (Object.hasOwn(models, value)) {
        input[field] = models[value];
        changes[`input.${field}`] = { from: value, to: input[field] };
      } else if (String(value || "").endsWith(".rad"))
        conflicts.push(`${job.id}: unknown ${field} ${value}.`);
    }
    const expected = String(resolved.defaults?.model || node.inputs.model || "");
    const explicit =
      input.modelName || (!String(input.model || "").startsWith("custom:") && input.model);
    if (explicit && explicit !== expected)
      conflicts.push(
        `${job.id}: its explicit model ${explicit} differs from profile model ${expected}; resolve the exact choice first.`,
      );
    if (expected.endsWith(".rad"))
      conflicts.push(`${job.id}: version its profile to Radiance 2 before migrating the queue.`);
    const capable = workers.filter(
      (worker) =>
        isRadianceWorker(worker) &&
        worker.capabilities.includes(job.input.kind === "video" ? "video" : "image"),
    );
    if (capable.length !== 1) {
      conflicts.push(`${job.id}: expected one configured native Radiance worker.`);
      continue;
    }
    const backend = capable[0].id;
    const resource = `worker:${backend}`;
    if (job.backend !== backend) changes.backend = { from: job.backend, to: backend };
    if (job.resource !== resource) changes.resource = { from: job.resource, to: resource };
    if (Object.keys(changes).length)
      plans.push({ job, next: { ...job, input, backend, resource }, changes });
  }
  if (apply && baseHash !== hash)
    conflicts.push("The queue changed since the dry run; review a fresh plan.");
  const result = {
    applied: false,
    preserved: true,
    hash,
    changes: plans.map(({ job, changes }) => ({ id: job.id, changes })),
    conflicts,
  };
  if (!apply || conflicts.length || !plans.length) return result;
  const key = crypto.randomBytes(32);
  const invariant = (job, changes) => {
    const value = structuredClone(job);
    delete value.updatedAt;
    for (const changed of Object.keys(changes)) {
      const [head, tail] = changed.split(".");
      if (tail) delete value[head][tail];
      else delete value[head];
    }
    return crypto.createHmac("sha256", key).update(canonical(value)).digest("hex");
  };
  for (const { next } of plans) store.save(next);
  const after = store.openJobs();
  result.preserved =
    canonical(after.map((job) => job.id)) === canonical(open.map((job) => job.id)) &&
    plans.every(({ job, next, changes }) => {
      const saved = store.job(job.ownerId, job.id);
      return (
        invariant(job, changes) === invariant(saved, changes) &&
        canonical({ ...saved, updatedAt: "" }) === canonical({ ...next, updatedAt: "" })
      );
    });
  if (!result.preserved)
    throw new Error("Queue migration changed an undeclared field; all writes rolled back.");
  result.applied = true;
  return result;
}
