import { draftedProfile } from "../assistant.js";
import { catalogDownloadsForFile } from "../catalog-downloads.js";
import { familyFromName, refinedFamily } from "../family-catalog.js";
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
    // A base model's families as the file's name narrows them (P-H3-Image from MiniMax H3).
    families: (baseModel, file) =>
      familiesFromMetadata({ base_model: String(baseModel || "") }).map((id) =>
        refinedFamily(id, file),
      ),
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
