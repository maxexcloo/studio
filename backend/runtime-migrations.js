import { reloadAccountPreferences } from "./account-preferences.js";
import { reloadAccountStore } from "./account-store.js";
import { chatRecordChanges, chatRecords } from "./chat-records.js";
import { comparisonSets } from "./comparison-sets.js";
import { directRoute } from "./domain/direct-route.ts";
import { dreamOwnership } from "./dream-ownership.js";
import { missingComfyOutputs } from "./missing-comfy-outputs.js";
import { pruneBackups } from "./prune-backups.js";

/**
 * The migrate-runtime steps, in the order they run, for the command (commands/migrate-runtime.mjs)
 * and POST /api/maintenance/migrations. `changes(plan)` counts what a step's plan lists to do.
 * An `online` step may apply while Studio runs: no request writes between its read and its write
 * (the steps are synchronous, or write through the server's own store), and `reload` then makes
 * the running server read what it wrote. Any other step writes state the server holds and cannot
 * reload, so it needs Studio stopped.
 */
// Applied steps are removed once the live data folder has them; Git history keeps them.
const steps = [
  {
    name: "chatRecords",
    run: chatRecords,
    changes: chatRecordChanges,
    online: true,
    reload: () => {
      reloadAccountStore();
      reloadAccountPreferences();
    },
  },
  {
    name: "pruneBackups",
    run: pruneBackups,
    changes: (plan) => plan.folders.length,
    online: true,
  },
  {
    name: "missingComfyOutputs",
    run: missingComfyOutputs,
    changes: (plan) => plan.missing,
    online: true,
  },
  {
    name: "comparisonSets",
    run: comparisonSets,
    changes: (plan) => plan.items,
    online: true,
  },
];

const stopped =
  "Needs Studio stopped: run migrate-runtime against the data folder (README.md, Data & Migrations).";

/**
 * Each step's plan, or with `apply` its result (a `backup` path where it writes one). `online`
 * (the running server) skips applying a step that isn't online-safe and has work, returning its
 * plan with `refused`. `dreamOwner` adds the Dream ownership step (the command's --dream-owner).
 * `gallery` is the running server's, for steps that check or patch its records.
 */
export async function runtimeMigrations(
  dataDir,
  { apply = false, online = false, dreamOwner = "", gallery } = {},
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
      results[step.name] = await step.run(dataDir, { apply, gallery });
      if (apply && results[step.name].applied) step.reload?.(dataDir);
    } catch (error) {
      throw new Error(`${step.name}: ${error.message}`, { cause: error });
    }
  }
  return results;
}

/** What the server log records of a run: per step its change count, outcome and backup. */
function summary(results, apply) {
  return (
    Object.entries(results)
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
      .join("; ") || "no steps pending"
  );
}

/**
 * POST /api/maintenance/migrations, administrators only: `{ apply?: boolean }`. Without `apply`
 * it returns every step's plan; with it, it applies the online-safe steps against Studio's data
 * folder and refuses the others that have work. `{ ok, apply, steps: { <name>: result } }`.
 */
export function registerMigrationRoutes(app, { dataDir, adminRefusal, gallery, log = console }) {
  directRoute(app, "POST", "/api/maintenance/migrations", async (account, { body }) => {
    const refused = adminRefusal(account);
    if (refused) return refused;
    const apply = body?.apply === true;
    try {
      const results = await runtimeMigrations(dataDir, { apply, online: true, gallery });
      log.info?.(`[migrations] ${apply ? "Apply" : "Dry run"}: ${summary(results, apply)}`);
      return { status: 200, payload: { ok: true, apply, steps: results } };
    } catch (error) {
      log.warn?.(`[migrations] ${apply ? "Apply" : "Dry run"} failed: ${error.message}`);
      return { status: 500, payload: { ok: false, error: error.message } };
    }
  });
}
