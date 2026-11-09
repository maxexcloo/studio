import { migrateGalleryRows, migrateRuntime } from "./persistence/migration.ts";
import { migrateJsonStores } from "./persistence/json-stores.ts";
import { migrateStatusWords } from "./persistence/status-words.ts";
import { accountAccess } from "./account-migration.js";
import { directRoute } from "./domain/direct-route.ts";
import { reloadAccountStore } from "./account-store.js";
import { combinedProfiles } from "./combined-profiles.js";
import { dreamOwnership } from "./dream-ownership.js";
import { envSettings } from "./env-settings.js";
import { gallerySizes } from "./gallery-sizes.js";
import { legacyRecords } from "./legacy-records.js";
import { reloadCatalogue } from "./library/catalogue.js";
import { downloadSources } from "./library/download-sources.js";
import { loraLayers } from "./library/lora-layers.js";
import { loraRatings } from "./lora/ratings.js";
import { profilePrompting } from "./profile/prompting-migration.js";
import { profileIds } from "./profile/rename.js";
import { createProfileStore } from "./profile/store.js";
import { reloadTimings } from "./timings.js";
import { uncensoredMarker } from "./uncensored-marker.js";
import { migrateUploads } from "./uploads.js";
import { gallerySources, versionSources } from "./version-sources.js";
import { reloadWorkflowPreferences } from "./workflow-catalogue.js";

/**
 * The migrate-runtime steps, in the order they run, for the command (commands/migrate-runtime.mjs)
 * and POST /api/maintenance/migrations. `changes(plan)` counts what a step's plan lists to do.
 * An `online` step may apply while Studio runs: every step is synchronous, so no request writes
 * between its read and its write, and `reload` then makes the running server read what it wrote
 * (the steps without one write only files Studio reads afresh each time). Any other step writes
 * state the server holds and cannot reload (profiles, preferences, the queue, the gallery,
 * process environment) or moves the database's contents, so it needs Studio stopped.
 */
const size = (value) => (Array.isArray(value) ? value.length : Object.keys(value || {}).length);
const steps = [
  {
    name: "runtime",
    run: migrateRuntime,
    changes: (plan) => (plan.alreadyMigrated ? 0 : size(plan.mappings) + size(plan.conflicts)),
  },
  {
    name: "galleryRows",
    run: migrateGalleryRows,
    changes: (plan) =>
      plan.runtimeMigrated && !plan.alreadyMigrated
        ? size(plan.mappings) + size(plan.conflicts)
        : 0,
  },
  {
    name: "uploads",
    run: migrateUploads,
    changes: (plan) =>
      plan.galleryRowsMigrated && !plan.alreadyMigrated
        ? size(plan.mappings) + size(plan.conflicts)
        : 0,
  },
  {
    name: "combinedProfiles",
    run: combinedProfiles,
    changes: (plan) => plan.preferences + size(plan.loraStacks) + size(plan.guideBindings),
  },
  {
    name: "uncensoredMarker",
    run: uncensoredMarker,
    changes: (plan) => size(plan.profiles) + size(plan.files) + size(plan.accessProfiles),
  },
  {
    name: "accountAccess",
    run: accountAccess,
    changes: (plan) => size(plan.joined) + size(plan.groups) + (plan.defaultGroup ? 1 : 0),
    online: true,
    reload: () => reloadAccountStore(),
  },
  { name: "loraRatings", run: loraRatings, changes: (plan) => size(plan.files), online: true },
  { name: "versionSources", run: versionSources, changes: (plan) => size(plan.recorded) },
  // The server holds the gallery, so it passes a reload for this step (registerMigrationRoutes).
  {
    name: "gallerySources",
    run: gallerySources,
    changes: (plan) => size(plan.filled) + size(plan.versions),
    online: true,
  },
  // The server passes a reload for this step too.
  {
    name: "gallerySizes",
    run: gallerySizes,
    changes: (plan) => plan.corrected,
    online: true,
  },
  { name: "profilePrompting", run: profilePrompting, changes: (plan) => size(plan.profiles) },
  {
    name: "loraLayers",
    run: loraLayers,
    changes: (plan) => size(plan.loras),
    online: true,
    reload: reloadCatalogue,
  },
  {
    name: "downloadSources",
    run: downloadSources,
    changes: (plan) => size(plan.added) + size(plan.changed) + size(plan.skipped),
    online: true,
    reload: reloadCatalogue,
  },
  {
    name: "legacyRecords",
    run: legacyRecords,
    changes: (plan) =>
      size(plan.loraStacks) +
      size(plan.modelChoices) +
      plan.galleryReferences.records +
      plan.chatRequests,
  },
  {
    name: "profileIds",
    run: profileIds,
    changes: (plan) =>
      size(plan.profiles) +
      size(plan.guides) +
      size(plan.conflicts) +
      plan.bindings +
      size(plan.grants) +
      plan.preferences +
      size(plan.loraStacks) +
      plan.timings,
    online: true,
    reload: (dataDir) => {
      reloadAccountStore();
      reloadWorkflowPreferences(createProfileStore({ dataDir }).canonical);
      reloadTimings();
    },
  },
  {
    name: "envSettings",
    run: envSettings,
    changes: (plan) => size(plan.moved) + size(plan.removed),
  },
  {
    name: "jsonStores",
    run: migrateJsonStores,
    changes: (plan) => (plan.alreadyMigrated ? 0 : size(plan.mappings) + size(plan.conflicts)),
  },
  {
    name: "statusWords",
    run: migrateStatusWords,
    changes: (plan) => (plan.alreadyMigrated ? 0 : size(plan.mappings)),
  },
];

const stopped =
  "Needs Studio stopped: run migrate-runtime against the data folder (CONFIGURATION.md, SQLite Migration & Rollback).";

/**
 * Each step's plan, or with `apply` its result (a `backup` path where it writes one). `online`
 * (the running server) skips applying a step that isn't online-safe and has work, returning its
 * plan with `refused`. `dreamOwner` adds the Dream ownership step (the command's --dream-owner).
 * `reload` maps a step's name to what makes the running server read what that step applied.
 */
export async function runtimeMigrations(
  dataDir,
  { apply = false, online = false, dreamOwner = "", reload = {} } = {},
) {
  const list = dreamOwner
    ? [
        ...steps,
        {
          name: "dreamOwnership",
          run: (dir, options) => dreamOwnership(dir, { ...options, owner: dreamOwner }),
        },
      ]
    : steps;
  const results = {};
  for (const step of list) {
    try {
      if (apply && online && !step.online) {
        const plan = await step.run(dataDir);
        results[step.name] = step.changes?.(plan) ? { ...plan, refused: stopped } : plan;
        continue;
      }
      results[step.name] = await step.run(dataDir, { apply });
      if (apply && results[step.name].applied) {
        step.reload?.(dataDir);
        reload[step.name]?.();
      }
    } catch (error) {
      throw new Error(`${step.name}: ${error.message}`, { cause: error });
    }
  }
  return results;
}

/** What the server log records of a run: per step its change count, outcome and backup. */
function summary(results, apply) {
  return Object.entries(results)
    .map(([name, result]) => {
      const count = steps.find((step) => step.name === name)?.changes(result) ?? 0;
      const outcome = result.refused
        ? "refused (needs Studio stopped)"
        : apply && result.applied && count
          ? "applied"
          : count
            ? "planned"
            : "nothing to do";
      return `${name}: ${count} ${outcome}${result.backup ? `, backup ${result.backup}` : ""}`;
    })
    .join("; ");
}

/**
 * POST /api/maintenance/migrations, administrators only: `{ apply?: boolean }`. Without `apply`
 * it returns every step's plan; with it, it applies the online-safe steps against Studio's data
 * folder and refuses the others that have work. `{ ok, apply, steps: { <name>: result } }`.
 */
export function registerMigrationRoutes(app, { dataDir, adminRefusal, reload, log = console }) {
  directRoute(app, "POST", "/api/maintenance/migrations", async (account, { body }) => {
    const refused = adminRefusal(account);
    if (refused) return refused;
    const apply = body?.apply === true;
    try {
      const results = await runtimeMigrations(dataDir, { apply, online: true, reload });
      log.info?.(`[migrations] ${apply ? "Apply" : "Dry run"}: ${summary(results, apply)}`);
      return { status: 200, payload: { ok: true, apply, steps: results } };
    } catch (error) {
      log.warn?.(`[migrations] ${apply ? "Apply" : "Dry run"} failed: ${error.message}`);
      return { status: 500, payload: { ok: false, error: error.message } };
    }
  });
}
