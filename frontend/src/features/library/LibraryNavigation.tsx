import { cardKinds } from "../../../../shared/characters";
import { icons } from "../../ui/icons";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";
import { useGroupFeature, useIsAdmin } from "../auth/AccountGate";

// Personal records first, then the shared Models, Prompting and Templates an administrator manages;
// each group alphabetical, apart from Presets leading its own cards.
export const librarySections = {
  presets: {
    label: "Presets",
    description: "Open a saved prompt or set of generation settings in Composer.",
    icon: icons.preset,
    group: "Personal",
  },
  characters: {
    label: "Characters",
    description: "Reuse character descriptions and reference images.",
    icon: icons.character,
    group: "Personal",
  },
  outfits: {
    label: "Outfits",
    description: "Reuse outfits across generations.",
    icon: icons.outfit,
    group: "Personal",
  },
  scenes: {
    label: "Scenes",
    description: "Reuse locations and settings across generations.",
    icon: icons.scene,
    group: "Personal",
  },
  files: {
    label: "Files",
    description:
      "Manage the shared checkpoints, diffusion models, text encoders and VAEs profiles use.",
    icon: icons.files,
    admin: true,
    group: "Models",
  },
  imports: {
    label: "Imports",
    description: "Import shared models and recipes from Civitai, Hugging Face or recipe images.",
    icon: icons.import,
    admin: true,
    group: "Models",
  },
  loras: {
    label: "LoRAs",
    description: "Manage the shared style and subject adapters offered in Composer.",
    icon: icons.loras,
    admin: true,
    group: "Models",
  },
  profiles: {
    label: "Profiles",
    description:
      "Manage the shared generation profiles and workflows. Every saved version is kept.",
    icon: icons.profile,
    admin: true,
    group: "Models",
  },
  guides: {
    label: "Guides",
    description:
      "Manage the prompting guides profiles and families use. Every saved version is kept.",
    icon: icons.guide,
    admin: true,
    group: "Prompting",
  },
  instructions: {
    label: "Instructions",
    description:
      "Manage the instructions Studio's writers follow for prompts, suggestions, Dream, captions and reviews. Every saved version is kept.",
    icon: icons.prompt,
    admin: true,
    group: "Prompting",
  },
  animateTemplates: {
    label: "Animate",
    description: "Manage the templates Animate offers.",
    icon: icons.animate,
    admin: true,
    group: "Templates",
  },
  changeTemplates: {
    label: "Edit & Recreate",
    description: "Manage the templates Edit and Recreate offer.",
    icon: icons.edit,
    admin: true,
    group: "Templates",
  },
  improveTemplates: {
    label: "Improve Prompt",
    description: "Manage the templates Improve Prompt offers.",
    icon: icons.promptStyles,
    admin: true,
    group: "Templates",
  },
};
/** Administrators see the whole Library; other accounts only their Presets and cards. */
export function useLibraryNavigation() {
  const admin = useIsAdmin();
  const characters = useGroupFeature("characters");
  return {
    admin,
    options: visibleSections(
      librarySections,
      admin,
      (key) => !Object.hasOwn(cardKinds, key) || characters,
    ),
  };
}
export function LibraryTitle() {
  const { options } = useLibraryNavigation();
  return <WorkspaceSectionSelect label="Library" sections={options} />;
}
