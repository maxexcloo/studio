import { canAdmin } from "../access.js";
import { animateProfile } from "../animate-profile.js";
import { familyLabels, modelsForAccount, withFailing, withProfileAliases } from "./catalogue.js";

/**
 * The catalogue for the browser (/api/models) and Animate's model choice. `catalogue` is
 * model/catalogue.js; `libraryUpdates()` the Library's update check, once it is registered.
 */
export function registerModelRoutes(app, { catalogue, libraryUpdates }) {
  /** The Library is administration: an administrator account, or whoever may administer a single-user Studio. */
  function withLibrary(models, req) {
    if (!models?.features) return models;
    const library = canAdmin(req);
    // Update Available puts a dot on the Library's dock icon.
    const updates = library ? libraryUpdates()?.summary().available || 0 : 0;
    return {
      ...models,
      features: { ...models.features, library, ...(updates ? { libraryUpdates: updates } : {}) },
    };
  }

  app.get("/api/models", async (req, res) => {
    try {
      // MCP submissions reuse backend metadata; the studio’s rescan stays fresh.
      const { models } = await catalogue.mediaModels(req.query.cached !== "1");
      res.json({
        ...withFailing(withProfileAliases(withLibrary(modelsForAccount(models, req), req))),
        familyLabels,
      });
    } catch {
      res.json({
        ...withFailing(
          withProfileAliases(
            withLibrary(modelsForAccount(catalogue.unavailableModels(), req), req),
          ),
        ),
        familyLabels,
      });
    }
  });

  /** Animate's profile for an account (animate-profile.js), from its catalogue and whether a local video worker answered. */
  async function animateChoice(account, { tier, width, height } = {}) {
    const models = modelsForAccount(await catalogue.catalogueModels(), { studioAccount: account });
    return animateProfile(models.profiles || [], {
      defaultId: models.defaults?.videoModel,
      localRunning: models.backends?.video?.available !== false,
      localParked: models.backends?.video?.parked === true,
      tier,
      width,
      height,
    });
  }
  // Every Animate surface asks this before queuing or staging, so it shows the model that will run.
  app.get("/api/animate/profile", async (req, res) => {
    try {
      const { profile, cloud, size, tiers } = await animateChoice(req.studioAccount, {
        // Fast or Quality, as Animate's menu offers them.
        tier: req.query.tier === "quality" ? "quality" : "fast",
        width: Number(req.query.width),
        height: Number(req.query.height),
      });
      res.json({ profileId: profile.id, label: profile.label || profile.id, cloud, size, tiers });
    } catch (error) {
      res.status(409).json({ ok: false, error: error.message });
    }
  });
}
