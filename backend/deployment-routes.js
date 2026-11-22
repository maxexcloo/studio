import { dreamOverrideKeys, dreamSettingError } from "../shared/dream.ts";
import { defaultTextProfileKey } from "./account-preferences.js";
import { deploymentTextModel, textModels } from "./assistant-routes.js";
import {
  catalogueFlags,
  defaultProfileKeys,
  describeDreamOverrides,
  describeFlag,
  isCatalogueFlag,
  saveDeploymentSetting,
  saveFlag,
  settingSource,
} from "./deployment-settings.js";
import { mediaDefaultProfileKeys } from "./generation-defaults.js";
import { requireAdmin } from "./route-access.js";

/**
 * Settings › Deployment. `mediaModels` and `unavailableModels` are model/catalogue.js's;
 * `assistantEngine` is the prompt assistant, or undefined without one.
 */
export function registerDeploymentRoutes(
  app,
  { assistantEngine, mediaModels, unavailableModels, workloadModels = () => [] },
) {
  /**
   * What the deployment decides, for Settings: each value with its source
   * (the deployment, saved from Settings, or the default) and whether it is locked.
   */
  app.get("/api/settings/deployment", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    const models = await mediaModels(false)
      .then((result) => result.models)
      .catch(() => unavailableModels());
    const profiles = (models.profiles || []).map((profile) => ({
      id: profile.id,
      label: profile.displayName || profile.label || profile.id,
      kind: profile.kind,
      ready: profile.ready !== false,
    }));
    const defaultFor = (key, effective) => ({
      key,
      configured: process.env[key] || "",
      effective: effective || "",
      ...settingSource(key),
    });
    const text = await deploymentTextModel({ engine: assistantEngine });
    res.json({
      ok: true,
      defaults: {
        image: defaultFor(mediaDefaultProfileKeys.image, models.defaults?.imageModel),
        video: defaultFor(mediaDefaultProfileKeys.video, models.defaults?.videoModel),
        text: defaultFor(defaultTextProfileKey, text),
        textModels: assistantEngine ? await textModels(assistantEngine, workloadModels()) : [],
        profiles,
      },
      catalogue: catalogueFlags.map(describeFlag),
      dream: describeDreamOverrides(),
    });
  });

  app.post("/api/settings/deployment", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const key = String(req.body?.key || "");
    const value = req.body?.value;
    const dreamKey = Object.keys(dreamOverrideKeys).find((name) => dreamOverrideKeys[name] === key);
    if (dreamKey) {
      // null leaves the setting to each account.
      const error = value === null ? "" : dreamSettingError(dreamKey, value);
      if (error) return res.status(400).json({ ok: false, error });
      saveDeploymentSetting(key, typeof value === "boolean" ? (value ? "1" : "0") : value);
      res.json({ ok: true, dream: describeDreamOverrides() });
      return;
    }
    if (isCatalogueFlag(key)) {
      if (typeof value !== "boolean") throw new Error("Choose on or off.");
      res.json({ ok: true, setting: { ...saveFlag(key, value), key } });
      return;
    }
    if (defaultProfileKeys.includes(key)) {
      const id = String(value || "").trim();
      if (id.length > 256 || /[\r\n]/.test(id)) throw new Error("Choose a valid profile.");
      if (
        key === defaultTextProfileKey &&
        id &&
        !/^(cloud|local)\/[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(id)
      )
        return res.status(400).json({ ok: false, error: "Choose a valid text profile." });
      res.json({ ok: true, setting: { ...saveDeploymentSetting(key, id), key } });
      return;
    }
    res.status(400).json({ ok: false, error: "That setting cannot be changed here." });
  });
}
