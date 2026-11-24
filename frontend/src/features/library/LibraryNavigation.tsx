import { cardKinds } from "../../../../shared/characters";
import { icons } from "../../ui/icons";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";
import { useGroupFeature, useIsAdmin } from "../auth/AccountGate";

/** Each instruction type's Prompting page, by the `area` its instructions carry. */
export const instructionAreas = {
  chatInstructions: { area: "Chat", icon: icons.chat },
  composeInstructions: { area: "Compose", icon: icons.prompt },
  dreamInstructions: { area: "Dream", icon: icons.dream },
  galleryInstructions: { area: "Gallery", icon: icons.image },
  libraryInstructions: { area: "Library", icon: icons.library },
  writingInstructions: { area: "Writing Standard", icon: icons.writing },
} as const;
export type InstructionSection = keyof typeof instructionAreas;
const instructionSection = (section: InstructionSection) => ({
  label: instructionAreas[section].area,
  description: `Manage the instructions Studio's ${instructionAreas[section].area} writers follow. Every saved version is kept.`,
  icon: instructionAreas[section].icon,
  admin: true,
  group: "Prompting",
});

// Personal records first, then the shared Profiles, Prompting and Templates an administrator
// manages; each group alphabetical, apart from Presets leading its own cards.
export const librarySections = {
  presets: {
    label: "Presets",
    description: "Open a saved prompt or set of generation settings in Composer.",
    icon: icons.preset,
    group: "Personal",
  },
  characters: {
    label: "Characters",
    description: "Reuse characters' descriptions and reference images across generations.",
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
  // Imports come first: they bring in what Files, LoRAs and Models then manage.
  imports: {
    label: "Imports",
    description: "Import shared models, LoRAs and recipes from Civitai, Hugging Face or images.",
    icon: icons.import,
    admin: true,
    group: "Profiles",
  },
  files: {
    label: "Files",
    description:
      "Manage the shared checkpoints, diffusion models, text encoders and VAEs that models use.",
    icon: icons.files,
    admin: true,
    group: "Profiles",
  },
  loras: {
    label: "LoRAs",
    description: "Manage the shared style and subject adapters offered in Composer.",
    icon: icons.loras,
    admin: true,
    group: "Profiles",
  },
  profiles: {
    label: "Models",
    description: "Manage the shared models and their workflows. Every saved version is kept.",
    icon: icons.profile,
    admin: true,
    group: "Profiles",
  },
  chatInstructions: instructionSection("chatInstructions"),
  composeInstructions: instructionSection("composeInstructions"),
  dreamInstructions: instructionSection("dreamInstructions"),
  galleryInstructions: instructionSection("galleryInstructions"),
  guides: {
    label: "Guides",
    description:
      "Manage the prompting guides models and families use. Every saved version is kept.",
    icon: icons.guide,
    admin: true,
    group: "Prompting",
  },
  libraryInstructions: instructionSection("libraryInstructions"),
  writingInstructions: instructionSection("writingInstructions"),
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
