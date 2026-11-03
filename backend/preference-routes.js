import { ownerIdForRequest } from "./account-ownership.js";
import {
  accountPreferences,
  saveAccountPreferences,
  savedPreferenceKeys,
} from "./account-preferences.js";
import { groupGrants } from "./account-store.js";

/**
 * Settings › Preferences: the caller's own preferences, and which of Cloud Models and Uncensored
 * Models its role or group grants, which it may turn off for itself.
 */
export function registerPreferenceRoutes(app) {
  const show = (req) => {
    const ownerId = ownerIdForRequest(req);
    return {
      preferences: accountPreferences(ownerId),
      saved: savedPreferenceKeys(ownerId),
      grants: (ownerId && groupGrants(ownerId)) || { cloudModels: false, uncensoredModels: false },
    };
  };
  app.get("/api/preferences", (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.json(show(req));
  });
  app.patch("/api/preferences", (req, res) => {
    const { grants } = show(req);
    const patch = req.body || {};
    for (const feature of ["cloudModels", "uncensoredModels"])
      if (patch[feature] !== undefined && !grants[feature])
        return res.status(400).json({
          ok: false,
          error: "Your group doesn’t grant that, so there is nothing to turn off.",
        });
    try {
      saveAccountPreferences(ownerIdForRequest(req), patch);
      res.json(show(req));
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}
