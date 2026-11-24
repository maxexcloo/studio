import { isCloudProfile, runBackend } from "../shared/profiles.ts";
import { ownedQuery, recordBelongsToRequest } from "./account-ownership.js";
import { downscaleReferences } from "./assistant-routes.js";
import { logWarning } from "./crash-log.js";
import { families } from "./family-catalogue.js";
import { eachGalleryItem } from "./gallery/store.js";
import { loraInfos } from "./lora/info.js";
import { accountMayUseLoras, loraAllowed, modelsForAccount } from "./model/catalogue.js";
import { livePrompting } from "./profile/store.js";
import { bytesForReferenceAccount, captionForReferenceAccount } from "./references.js";
import { defaultWorkerId } from "./workers.js";
import { runProfile } from "./workflow-modes.js";

/**
 * What the prompt assistant reads for an account: its profiles, their prompting guides, its LoRAs,
 * its liked prompts and reference images. `catalogueModels` and `installedLoras` are
 * model/catalogue.js's.
 */
export function createAssistantContext({ catalogueModels, installedLoras }) {
  const guides = (() => {
    try {
      return livePrompting();
    } catch (error) {
      logWarning(`The prompt assistant has no guides: ${error.message}`);
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
  const loras = async (req, available) => {
    if (!accountMayUseLoras(req)) return [];
    try {
      const names = (available ?? installedLoras()).filter(loraAllowed(req.studioAccount));
      const infos = await loraInfos(defaultWorkerId(), names);
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
  // Learning from likes: the account's six newest liked prompts on the same family, and their LoRAs.
  const liked = async (req, profile) => {
    const families = new Map((await profiles(req)).map((item) => [item.id, item.family]));
    const same = (item, id = item.settings?.profileId) =>
      id === profile.id || (profile.family && families.get(id) === profile.family);
    const items = [];
    for (const item of eachGalleryItem({
      ...ownedQuery(req.studioAccount),
      rating: "liked",
      status: "done",
    })) {
      if (item.prompt && recordBelongsToRequest(item, req) && same(item)) items.push(item);
      if (items.length === 6) break;
    }
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
  /** What a reference image shows in words (its gallery caption), for a writer that can't see it; or "". */
  const caption = (account, id) => (id ? captionForReferenceAccount(account, id) : "");
  /**
   * The prompt guide for a result's profile or a selected editor's reference mode.
   */
  async function target(account, profileId, edit = false) {
    const listed = (await profiles({ studioAccount: account })).find(
      (item) => item.id === profileId,
    );
    if (!listed) return null;
    const backend = edit
      ? runBackend(listed.backendOptions || [], listed.backend, undefined, true)
      : undefined;
    const selected = backend ? runProfile(listed, backend) : listed;
    const option = backend && listed.backendOptions?.find(({ id }) => id === backend);
    const ready = option?.profile ? option.ready : selected.ready;
    if (
      edit &&
      (selected.kind !== "image" ||
        ready === false ||
        !(
          selected.mediaInputs?.length ||
          selected.capabilities?.img2img ||
          selected.capabilities?.imageInput
        ))
    )
      return null;
    const mode = edit && selected.imageModes?.reference;
    const profile = mode ? { ...selected, ...mode } : selected;
    const family = families[String(profile.family || "").replaceAll("-", "_")];
    const edits =
      isCloudProfile(profile) || profile.editReferences || family?.references
        ? "instruction"
        : edit || family?.img2img
          ? "description"
          : undefined;
    return {
      label: profile.label || profile.id,
      guide: guide(profile),
      ...(edits ? { edits } : {}),
      ...(option?.profile ? { profileBackend: option.id } : {}),
    };
  }
  return { caption, guide, image, liked, loras, profiles, target };
}
