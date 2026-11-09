import {
  assistantIntegration,
  assistantSettingKeys,
  assistantSettingValue,
} from "./assistant-routes.js";
import { civitaiTokenStatus } from "./civitai/access.js";
import {
  catalogueFlags,
  describeFlag,
  isCatalogueFlag,
  saveDeploymentSetting,
  saveFlag,
  settingSource,
} from "./deployment-settings.js";
import { hfTokenStatus } from "./hf-access.js";
import { requireAdmin } from "./route-access.js";

/**
 * Settings › Deployment. `mediaModels` and `unavailableModels` are model/catalogue.js's;
 * `assistantEngine` is the prompt assistant, or undefined without one; `runtime` lists the text
 * workloads whose models the assistant may use.
 */
export function registerDeploymentRoutes(
  app,
  { assistantEngine, mediaModels, runtime, unavailableModels },
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
    res.json({
      ok: true,
      defaults: {
        image: defaultFor("STUDIO_DEFAULT_IMAGE_PROFILE", models.defaults?.imageModel),
        video: defaultFor("STUDIO_DEFAULT_VIDEO_PROFILE", models.defaults?.videoModel),
        profiles,
      },
      catalogue: catalogueFlags.map(describeFlag),
      integrations: {
        civitai: { token: civitaiTokenStatus() },
        huggingFace: { token: hfTokenStatus() },
        assistant: await assistantIntegration({
          engine: assistantEngine,
          source: settingSource,
          // The gateway lists only running models; stopped text workloads' models are choices too.
          workloadModels: (runtime?.controller.workloads || [])
            .filter((item) => item.kind === "text" && item.model)
            .map((item) => item.model),
        }),
      },
    });
  });

  app.post("/api/settings/deployment", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const key = String(req.body?.key || "");
    const value = req.body?.value;
    try {
      if (isCatalogueFlag(key)) {
        if (typeof value !== "boolean") throw new Error("Choose on or off.");
        res.json({ ok: true, setting: { ...saveFlag(key, value), key } });
        return;
      }
      if (assistantSettingKeys.includes(key)) {
        res.json({
          ok: true,
          setting: {
            ...saveDeploymentSetting(key, assistantSettingValue(key, value)),
            key,
          },
        });
        return;
      }
      if (key === "STUDIO_DEFAULT_IMAGE_PROFILE" || key === "STUDIO_DEFAULT_VIDEO_PROFILE") {
        const id = String(value || "").trim();
        if (id.length > 256 || /[\r\n]/.test(id)) throw new Error("Choose a valid profile.");
        res.json({ ok: true, setting: { ...saveDeploymentSetting(key, id), key } });
        return;
      }
      res.status(400).json({ ok: false, error: "That setting cannot be changed here." });
    } catch (error) {
      res.status(error.status || 400).json({ ok: false, error: error.message });
    }
  });
}
