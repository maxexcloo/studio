import { reloadAccountPreferences } from "./account-preferences.js";
import { reloadAccountStore } from "./account-store.js";
import { characterGenerated } from "./character-generated.js";
import { chatBriefRemoval } from "./chat-brief-removal.js";
import { logger } from "./crash-log.js";
import { directRoute } from "./domain/direct-route.ts";
import { dreamAnimationStars } from "./dream-animation-stars.js";
import { dreamDefaultChoices } from "./dream-default-choices.js";
import { dreamOwnership } from "./dream-ownership.js";
import { flux2Records } from "./flux2-records.js";
import { galleryRatings } from "./gallery-ratings.js";
import { imageSizeDefaults } from "./image-size-defaults.js";
import { legacyShapes } from "./legacy-shapes.js";
import { importStore } from "./library/imports.js";
import { localTextAuto } from "./local-text-auto.js";
import { loraStacks } from "./lora-stacks.js";
import { mcpOwnershipRows } from "./mcp-ownership-rows.js";
import { profileAliases } from "./profile-aliases.js";
import { migrateRadianceQueue } from "./radiance-queue-migration.js";
import { runtimeSettings } from "./runtime-settings.js";
import { spicyPrompts } from "./spicy-prompts.js";
import { tasteDislikes } from "./taste-dislikes.js";
import { whereWorkRuns } from "./where-work-runs.js";

/**
 * The migrate-runtime steps, in the order they run, for the command (commands/migrate-runtime.mjs)
 * and POST /api/maintenance/migrations. `changes(plan)` counts what a step's plan lists to do.
 * An `online` step may apply while Studio runs: no request writes between its read and its write
 * (each read and its write happen in one turn, or go through the server's own store), and `reload`
 * then makes the running server read what it wrote. Any other step writes state the server holds
 * and cannot reload, so it needs Studio stopped.
 */
// Gallery, queue, Dream and MCP copies go with the restart that follows (profile-aliases.js).
function reloadProfileRecords(dataDir) {
  reloadAccountStore();
  reloadAccountPreferences();
  importStore({ dataDir }).reload();
}

// Applied steps are removed once the live data folder has them; Git history keeps them.
const steps = [
  {
    name: "dreamAnimationStars",
    run: dreamAnimationStars,
    changes: (plan) => plan.stars,
    online: true,
  },
  {
    name: "mcpOwnership",
    run: mcpOwnershipRows,
    changes: (plan) => (plan.document ? 1 : 0),
    online: true,
  },
  {
    name: "galleryRatings",
    run: galleryRatings,
    changes: (plan) => plan.likes + plan.unstarred + plan.dislikes + plan.signals,
    online: true,
  },
  {
    name: "characterGenerated",
    run: characterGenerated,
    changes: (plan) => plan.characters,
    online: true,
  },
  {
    name: "legacyShapes",
    run: legacyShapes,
    changes: (plan) => plan.arms + plan.notes + (plan.editsFile ? 1 : 0),
    online: true,
  },
  {
    name: "loraStacks",
    run: loraStacks,
    changes: (plan) => plan.accounts,
    online: true,
  },
  {
    name: "dreamDefaultChoices",
    run: dreamDefaultChoices,
    changes: (plan) => plan.settings + plan.accounts,
    online: true,
  },
  {
    name: "tasteDislikes",
    run: tasteDislikes,
    changes: (plan) => plan.accounts,
    online: true,
  },
  {
    name: "spicyPrompts",
    run: spicyPrompts,
    changes: (plan) => plan.accounts,
    online: true,
  },
  {
    name: "chatBriefRemoval",
    run: chatBriefRemoval,
    changes: (plan) => plan.accounts,
    online: true,
    reload: reloadAccountPreferences,
  },
  {
    name: "imageSizeDefaults",
    run: imageSizeDefaults,
    changes: (plan) => plan.profiles.length,
    online: true,
  },
  {
    name: "whereWorkRuns",
    run: whereWorkRuns,
    changes: (plan) => plan.accounts,
    online: true,
    reload: reloadAccountPreferences,
  },
  {
    name: "localTextAuto",
    run: localTextAuto,
    changes: (plan) => plan.accounts,
    online: true,
    reload: reloadAccountPreferences,
  },
  {
    name: "profileAliases",
    run: profileAliases,
    changes: (plan) => plan.aliases + plan.records,
    online: true,
    reload: reloadProfileRecords,
  },
  {
    name: "flux2Records",
    run: flux2Records,
    changes: (plan) => plan.records,
    online: true,
    reload: reloadProfileRecords,
  },
  {
    name: "runtimeSettings",
    run: runtimeSettings,
    changes: (plan) => plan.settings,
  },
];

const stopped =
  "Needs Studio stopped: run migrate-runtime against the data folder (README.md, Data & Migrations).";

/**
 * Each step's plan, or with `apply` its result. `online`
 * (the running server) skips applying a step that isn't online-safe and has work, returning its
 * plan with `refused`. `dreamOwner` adds the Dream ownership step (the command's --dream-owner).
 */
export async function runtimeMigrations(
  dataDir,
  { apply = false, online = false, dreamOwner = "" } = {},
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
export function registerMigrationRoutes(app, { dataDir, store, adminRefusal, log = logger }) {
  if (store)
    directRoute(app, "POST", "/api/maintenance/radiance-queue", (account, { body }) => {
      const refused = adminRefusal(account);
      if (refused) return refused;
      const result = migrateRadianceQueue(store, {
        apply: body?.apply === true,
        baseHash: body?.baseHash,
      });
      return { status: result.conflicts.length ? 409 : 200, payload: result };
    });
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
