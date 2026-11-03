import { draftedProfile } from "../assistant.js";
import { catalogDownloadsForFile } from "../catalog-downloads.js";
import { familyFromName } from "../family-catalog.js";
import { familiesFromMetadata } from "../lora/info.js";
import { draftProfileFromImport } from "./drafts.js";
import {
  createEditableProfile,
  listEditableProfiles,
  profileIdTaken,
  readEditableProfile,
  validateProfileText,
} from "./editor.js";
import { guideStore } from "./store.js";

/**
 * A checkpoint or diffusion model import's AI-drafted profile and guide (profile/drafts.js): the
 * nearest same-family profile as template, parts through Download Missing, checked against
 * ComfyUI's object_info (`info()`) before it is written. Administrators only until approved.
 * `engine` is the prompt assistant that drafts it.
 */
export async function draftCheckpointProfile(record, options, { engine, info }) {
  return draftProfileFromImport(record, options, {
    templates: () =>
      listEditableProfiles()
        .filter((item) => item.readable)
        .map((item) => {
          try {
            return { ...item, raw: JSON.parse(readEditableProfile(item.id).text) };
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    info,
    families: (baseModel) => familiesFromMetadata({ base_model: String(baseModel || "") }),
    familyFromName: (file) => familyFromName(file),
    taken: profileIdTaken,
    downloadsFor: catalogDownloadsForFile,
    engine,
    draftedProfile,
    validate: validateProfileText,
    create: (id, text, { by }) =>
      createEditableProfile(id, text, {
        by,
        origin: "ai",
        aiDrafted: true,
        info: null,
        note: `Drafted from import ${record.id}`,
      }),
    guides: guideStore(),
  });
}
