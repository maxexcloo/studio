import { ownerIdForRequest } from "../account-ownership.js";
import { accountPreferences, kindDefaults } from "../account-preferences.js";
import { animateProfile } from "../animate-profile.js";
import { logger } from "../crash-log.js";
import { directRoute } from "../domain/direct-route.ts";
import { step } from "../event-loop.js";
import {
  familyLabels,
  modelsForAccount,
  withFailing,
  withPreferredDefaults,
  withProfileAliases,
} from "./catalogue.js";

/** The catalogue for the browser (/api/models) and Animate's model choice. `catalogue` is model/catalogue.js. */
export function registerModelRoutes(app, { catalogue }) {
  directRoute(app, "GET", "/api/models", async (account, { query }) => {
    const req = { studioAccount: account };
    // The account's catalogue, its defaults on the side its Images and Videos preferences choose.
    const forAccount = (models) =>
      withPreferredDefaults(
        modelsForAccount(models, req),
        query.preferences === "0" ? {} : accountPreferences(ownerIdForRequest(req)),
      );
    try {
      // MCP submissions reuse backend metadata; the studio's rescan stays fresh.
      const { models } = await step("models: workers", () =>
        catalogue.mediaModels(query.cached !== "1"),
      );
      return {
        status: 200,
        payload: {
          ...(await step("models: account", () =>
            withFailing(withProfileAliases(forAccount(models))),
          )),
          familyLabels,
        },
      };
    } catch (error) {
      // Workers that do not answer are part of the catalogue; only no worker at all falls back
      // here. Anything else is a bug, not an offline worker.
      if (!error?.noWorker) {
        logger.error("Models catalogue failed", error);
        return { status: 500, payload: { ok: false, error: error.message } };
      }
      return {
        status: 200,
        payload: {
          ...withFailing(withProfileAliases(forAccount(catalogue.unavailableModels()))),
          familyLabels,
        },
      };
    }
  });

  // Every Animate surface asks this before queuing or staging, so it shows the model that will run:
  // Animate's profile for the account (animate-profile.js), from its catalogue, whether a local video
  // worker answered, where it prefers videos to run and its default video model on each side.
  app.get("/api/animate/profile", async (req, res) => {
    try {
      const videos = kindDefaults(accountPreferences(ownerIdForRequest(req)), "videos");
      const models = modelsForAccount(await catalogue.catalogueModels(), req);
      const { profile, cloud, size, offers, note } = animateProfile(models.profiles || [], {
        defaultId: models.defaults?.videoModel,
        localRunning: models.backends?.video?.available !== false,
        localParked: models.backends?.video?.parked === true,
        prefer: videos.side,
        preferred: videos,
        width: Number(req.query.width),
        height: Number(req.query.height),
      });
      res.json({
        profileId: profile.id,
        label: profile.label || profile.id,
        cloud,
        size,
        offers,
        note,
      });
    } catch (error) {
      res.status(409).json({ ok: false, error: error.message, offers: error.offers });
    }
  });
}
