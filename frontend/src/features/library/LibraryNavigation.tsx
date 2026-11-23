import { BookOpen, Boxes, FileCog } from "lucide-react";

import { cardKinds } from "../../../../shared/characters";
import { icons } from "../../ui/icons";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";
import { useGroupFeature, useIsAdmin } from "../auth/AccountGate";

export const librarySections = {
  presets: {
    label: "Presets",
    description: "Open a saved prompt or set of generation settings in Composer.",
    icon: icons.preset,
  },
  characters: {
    label: "Characters",
    description: "Reuse character descriptions and reference images.",
    icon: icons.character,
    group: "Cards",
  },
  outfits: {
    label: "Outfits",
    description: "Reuse outfits across generations.",
    icon: icons.outfit,
    group: "Cards",
  },
  scenes: {
    label: "Scenes",
    description: "Reuse locations and settings across generations.",
    icon: icons.scene,
    group: "Cards",
  },
  guides: {
    label: "Guides",
    description: "Shared prompting guides for profiles and families. Every saved version is kept.",
    icon: BookOpen,
    admin: true,
    group: "Generation",
  },
  loras: {
    label: "LoRAs",
    description: "Manage shared style and subject adapters. Choose them in Composer to generate.",
    icon: icons.loras,
    admin: true,
    group: "Generation",
  },
  profiles: {
    label: "Profiles",
    description: "Shared generation profiles and workflows. Every saved version is kept.",
    icon: FileCog,
    admin: true,
    group: "Generation",
  },
  promptInstructions: {
    label: "Prompt Instructions",
    description: "Read and edit the instructions Studio sends to its writers.",
    icon: icons.prompt,
    admin: true,
    group: "Generation",
  },
  promptStyles: {
    label: "Prompt Styles",
    description: "Shared assistant styles and templates for Improve Prompt, Animate and Edit.",
    icon: icons.assistant,
    admin: true,
    group: "Generation",
  },
  files: {
    label: "Files",
    description:
      "Shared checkpoints, diffusion models, text encoders and VAEs. Choose a profile in Composer to generate.",
    icon: Boxes,
    admin: true,
    apart: true,
  },
  imports: {
    label: "Imports",
    description:
      "Shared models and recipes from Civitai, Hugging Face or recipe images, and the files they need.",
    icon: icons.import,
    admin: true,
    apart: true,
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
