import { recordBelongsToRequest } from "./account-ownership.js";
import { downscaleReferences } from "./assistant-routes.js";
import { optionsFor } from "./comfy/comfy.js";
import { gallery } from "./gallery/store.js";
import { loraInfos } from "./lora/info.js";
import { accountMayUseLoras, modelsForAccount } from "./model/catalogue.js";
import { canonicalProfileId, livePrompting } from "./profile/store.js";
import { bytesForReferenceAccount } from "./references.js";

/**
 * What the prompt assistant reads for an account: its profiles, their prompting guides, its LoRAs,
 * its starred prompts and reference images. `catalogueModels` and `loadComfyContext` are
 * model/catalogue.js's.
 */
export function createAssistantContext({ catalogueModels, loadComfyContext }) {
  const guides = (() => {
    try {
      return livePrompting();
    } catch (error) {
      console.warn(`[Studio] The prompt assistant has no guides: ${error.message}`);
      return () => null;
    }
  })();
  const profiles = async (req) => {
    try {
      return modelsForAccount(await catalogueModels(), req).profiles || [];
    } catch {
      return [];
    }
  };
  const loras = async (req) => {
    if (!accountMayUseLoras(req)) return [];
    try {
      const names = optionsFor((await loadComfyContext()).info, "LoraLoader", "lora_name");
      const infos = await loraInfos(names);
      return names.map((name) => ({ name, info: infos[name] || { families: [], triggers: [] } }));
    } catch {
      return [];
    }
  };
  const guide = (profile) => {
    try {
      return guides(profile);
    } catch {
      return null;
    }
  };
  // Learning from stars: the account's six newest starred prompts on the same family, and their LoRAs.
  const starred = async (req, profile) => {
    const families = new Map((await profiles(req)).map((item) => [item.id, item.family]));
    const same = (item, id = canonicalProfileId(item.settings?.profileId)) =>
      id === profile.id || (profile.family && families.get(id) === profile.family);
    const items = gallery
      .filter(
        (item) =>
          item.favorite &&
          item.status === "done" &&
          item.prompt &&
          recordBelongsToRequest(item, req) &&
          same(item),
      )
      .slice(0, 6);
    return {
      examples: items.map((item) => item.prompt),
      loras: [
        ...new Set(
          items.flatMap((item) =>
            (item.settings?.loras || []).map((lora) => lora?.name).filter(Boolean),
          ),
        ),
      ],
    };
  };
  /** A reference image as the text model reads it ({ mime, data }, downscaled), or null. */
  async function image(account, id) {
    if (!id) return null;
    const reference = await bytesForReferenceAccount(account, id);
    const [downscaled] = await downscaleReferences([
      `data:${reference.mime};base64,${reference.buffer.toString("base64")}`,
    ]);
    return downscaled || null;
  }
  return { guide, image, loras, profiles, starred };
}
