import { reloadAccountPreferences } from "./account-preferences.js";
import { cloudModelsPreference } from "./cloud-models-preference.js";
import { logger } from "./crash-log.js";
import { reloadDeploymentSettings } from "./deployment-settings.js";
import { directRoute } from "./domain/direct-route.ts";
import { projectsSimplify } from "./projects-simplify.js";
import { tasteSimplify } from "./taste-simplify.js";
import { uncensoredNames } from "./uncensored-names.js";
import { whereWorkRunsServerWide } from "./work-defaults-migration.js";

/**
 * The migrate-runtime steps, in the order they run, for the command (commands/migrate-runtime.mjs)
 * and POST /api/maintenance/migrations. `changes(plan)` counts what a step's plan lists to do.
 * An `online` step may apply while Studio runs: no request writes between its read and its write
 * (each read and its write happen in one turn, or go through the server's own store), and `reload`
 * then makes the running server read what it wrote. Any other step writes state the server holds
 * and cannot reload, so it needs Studio stopped.
 */
// Applied steps are removed once the live data folder has them; Git history keeps them.
const steps = [
  {
    name: "cloudModelsPreference",
    run: cloudModelsPreference,
    changes: (plan) => plan.accounts,
    online: true,
    reload: reloadAccountPreferences,
  },
  {
    name: "uncensoredNames",
    run: uncensoredNames,
    changes: (plan) =>
      Object.values(plan.rows).reduce((total, count) => total + count, plan.styleFiles),
    online: true,
    reload: reloadDeploymentSettings,
  },
  {
    name: "tasteSimplify",
    run: tasteSimplify,
    changes: (plan) => plan.accounts.length,
    online: true,
  },
  {
    name: "projectsSimplify",
    run: projectsSimplify,
    changes: (plan) => plan.projects.length + plan.proposals.length,
    online: true,
  },
  {
    name: "whereWorkRunsServerWide",
    run: whereWorkRunsServerWide,
    changes: (plan) =>
      Object.keys(plan.settings).length +
      plan.accounts.length +
      plan.dreams.length +
      plan.retiredOverrides.length,
    online: true,
    reload: () => {
      reloadDeploymentSettings();
      reloadAccountPreferences();
    },
  },
];

const stopped =
  "Needs Studio stopped: run migrate-runtime against the data folder (CONFIGURATION.md, Data & Migrations).";

/**
 * Each step's plan, or with `apply` its result. `online`
 * (the running server) skips applying a step that isn't online-safe and has work, returning its
 * plan with `refused`.
 */
export async function runtimeMigrations(dataDir, { apply = false, online = false } = {}) {
  const results = {};
  for (const step of steps) {
    try {
      if (apply && online && !step.online) {
        const plan = await step.run(dataDir);
        results[step.name] = step.changes?.(plan) ? { ...plan, refused: stopped } : plan;
        continue;
      }
      results[step.name] = await step.run(dataDir, { apply });
      if (apply && results[step.name].applied) step.reload?.(dataDir);
    } catch (error) {
      throw new Error(`${step.name}: ${error.message}`, { cause: error });
    }
  }
  return results;
}

/** What the server log records of a run: per step its change count and outcome. */
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
        return `${name}: ${count} ${outcome}`;
      })
      .join("; ") || "no steps pending"
  );
}

/**
 * POST /api/maintenance/migrations, administrators only: `{ apply?: boolean }`. Without `apply`
 * it returns every step's plan; with it, it applies the online-safe steps against Studio's data
 * folder and refuses the others that have work. `{ ok, apply, steps: { <name>: result } }`.
 */
export function registerMigrationRoutes(app, { dataDir, adminRefusal, log = logger }) {
  directRoute(app, "POST", "/api/maintenance/migrations", async (account, { body }) => {
    const refused = adminRefusal(account);
    if (refused) return refused;
    const apply = body?.apply === true;
    try {
      const results = await runtimeMigrations(dataDir, { apply, online: true });
      log.info?.(`[migrations] ${apply ? "Apply" : "Dry run"}: ${summary(results, apply)}`);
      return { status: 200, payload: { ok: true, apply, steps: results } };
    } catch (error) {
      log.warn?.(`[migrations] ${apply ? "Apply" : "Dry run"} failed: ${error.message}`);
      return { status: 500, payload: { ok: false, error: error.message } };
    }
  });
}
