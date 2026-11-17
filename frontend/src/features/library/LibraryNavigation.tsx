import { BookOpen, Boxes, FileCog } from "lucide-react";

import { cardKinds } from "../../../../shared/characters";
import { icons } from "../../ui/icons";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";
import { useGroupFeature, useIsAdmin } from "../auth/AccountGate";

export const librarySections = {
  chatBrief: {
    label: "Chat Brief",
    description: "Standing rules every chat keeps to, so you needn't repeat them.",
    icon: icons.chat,
    group: "AI",
  },
  presets: {
    label: "Presets",
    description:
      "Your saved presets: a prompt, model, settings or LoRAs to start from, or any mix of them.",
    icon: icons.preset,
    group: "AI",
  },
  characters: {
    label: "Characters",
    description: "Your character cards: reference images and descriptions to reuse in Composer.",
    icon: icons.character,
    group: "Cards",
  },
  outfits: {
    label: "Outfits",
    description: "Your reusable outfit descriptions. Images help you recognise each card.",
    icon: icons.outfit,
    group: "Cards",
  },
  scenes: {
    label: "Scenes",
    description: "Your reusable scene descriptions. Images help you recognise each card.",
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
  promptStyles: {
    label: "Prompt Styles",
    description:
      "Shared assistant styles and templates for Improve Prompt, Animate and Edit. Every saved version is kept.",
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
      "Shared models and recipes from Civitai, Hugging Face or recipe images, and their downloads.",
    icon: icons.import,
    admin: true,
    apart: true,
  },
};
/** Administrators see the whole Library; other accounts only their Chat Brief, Presets and cards. */
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
