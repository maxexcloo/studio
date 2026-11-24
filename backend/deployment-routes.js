import {
  dreamLimitSettings,
  dreamOverrideKeys,
  dreamSettingError,
  dreamTimingSettings,
  dreamUnseenOffKey,
  maxDreamIdleMinutes,
} from "../shared/dream.ts";
import { workSettings } from "../shared/work-defaults.ts";
import { deploymentTextModel, textModels } from "./assistant-routes.js";
import {
  catalogueFlags,
  defaultProfileKeys,
  describeDreamPolicy,
  describeFlag,
  describeWork,
  isCatalogueFlag,
  saveDeploymentSetting,
  saveFlag,
  settingSource,
} from "./deployment-settings.js";
import { defaultTextProfileKey, mediaDefaultProfileKeys } from "./generation-defaults.js";
import { requireAdmin } from "./route-access.js";
import { workSettingError } from "./work-defaults.js";

/**
 * Settings › Studio, Dream and Where Work Runs. `mediaModels` and `unavailableModels` are model/catalogue.js's;
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
      dream: describeDreamPolicy(),
      work: describeWork(),
    });
  });

  app.post("/api/settings/deployment", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const key = String(req.body?.key || "");
    const value = req.body?.value;
    const timing = Object.values(dreamTimingSettings).find((setting) => setting.key === key);
    if (timing) {
      if (!Number.isInteger(value) || value < 0 || value > maxDreamIdleMinutes)
        return res.status(400).json({
          ok: false,
          error: `Set the delay to a whole number from 0 to ${maxDreamIdleMinutes}.`,
        });
      saveDeploymentSetting(key, value === timing.defaultValue ? "" : value);
      res.json({ ok: true, dream: describeDreamPolicy() });
      return;
    }
    const limit = Object.values(dreamLimitSettings).find((setting) => setting.key === key);
    if (limit) {
      if (!Number.isInteger(value) || value < 0 || value > limit.bound)
        return res.status(400).json({
          ok: false,
          error: `Set the limit to a whole number from 0 to ${limit.bound}.`,
        });
      saveDeploymentSetting(key, value === limit.defaultValue ? "" : value);
      res.json({ ok: true, dream: describeDreamPolicy() });
      return;
    }
    if (key === dreamUnseenOffKey) {
      if (typeof value !== "boolean") throw new Error("Choose on or off.");
      saveDeploymentSetting(key, value ? "1" : "");
      res.json({ ok: true, dream: describeDreamPolicy() });
      return;
    }
    const dreamKey = Object.keys(dreamOverrideKeys).find((name) => dreamOverrideKeys[name] === key);
    if (dreamKey) {
      // null leaves the setting to each account.
      const error = value === null ? "" : dreamSettingError(dreamKey, value);
      if (error) return res.status(400).json({ ok: false, error });
      saveDeploymentSetting(key, typeof value === "boolean" ? (value ? "1" : "0") : value);
      res.json({ ok: true, dream: describeDreamPolicy() });
      return;
    }
    const workName = Object.keys(workSettings).find((name) => workSettings[name].key === key);
    if (workName) {
      // null clears it: a profile's own default applies, or Local for Dream.
      const error = value === null ? "" : workSettingError(workName, value);
      if (error) return res.status(400).json({ ok: false, error });
      saveDeploymentSetting(key, value === null ? "" : value);
      res.json({ ok: true, work: describeWork() });
      return;
    }
    if (isCatalogueFlag(key)) {
      if (typeof value !== "boolean") throw new Error("Choose on or off.");
      res.json({ ok: true, setting: { ...saveFlag(key, value), key } });
      return;
    }
    if (defaultProfileKeys.includes(key)) {
      const id = String(value || "").trim();
      if (id.length > 256 || /[\r\n]/.test(id)) throw new Error("Choose a valid model.");
      if (
        key === defaultTextProfileKey &&
        id &&
        !/^(cloud|local)\/[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(id)
      )
        return res.status(400).json({ ok: false, error: "Choose a valid text model." });
      res.json({ ok: true, setting: { ...saveDeploymentSetting(key, id), key } });
      return;
    }
    res.status(400).json({ ok: false, error: "That setting cannot be changed here." });
  });
}
