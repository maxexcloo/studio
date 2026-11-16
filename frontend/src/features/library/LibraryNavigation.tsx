import { ArchiveX, BookOpen, Boxes, FileCog, HardDriveDownload, Import } from "lucide-react";

import { cardKinds } from "../../../../shared/characters";
import { icons } from "../../ui/icons";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";
import { useGroupFeature, useIsAdmin } from "../auth/AccountGate";

export const librarySections = {
  characters: {
    label: "Characters",
    description: "Your character cards: reference images and descriptions to reuse in Composer.",
    icon: icons.character,
    group: "Personal",
  },
  outfits: {
    label: "Outfits",
    description: "Your reusable outfit descriptions. Images help you recognise each card.",
    icon: icons.outfit,
    group: "Personal",
  },
  presets: {
    label: "Presets",
    description:
      "Your saved presets: a prompt, model, settings or LoRAs to start from, or any mix of them.",
    icon: icons.preset,
    group: "Personal",
  },
  scenes: {
    label: "Scenes",
    description: "Your reusable scene descriptions. Images help you recognise each card.",
    icon: icons.scene,
    group: "Personal",
  },
  downloads: {
    label: "Downloads",
    description: "Shared model downloads. Stopping keeps partial files to resume.",
    icon: HardDriveDownload,
    admin: true,
    group: "Administration",
  },
  guides: {
    label: "Guides",
    description: "Shared prompting guides for profiles and families. Every saved version is kept.",
    icon: BookOpen,
    admin: true,
    group: "Administration",
  },
  imports: {
    label: "Imports",
    description:
      "Shared models and recipes from Civitai, Hugging Face or recipe images. Use Images › Upload for private images and Reddit posts.",
    icon: Import,
    admin: true,
    group: "Administration",
  },
  loras: {
    label: "LoRAs",
    description: "Manage shared style and subject adapters. Choose them in Composer to generate.",
    icon: icons.loras,
    admin: true,
    group: "Administration",
  },
  models: {
    label: "Models",
    description:
      "Manage shared checkpoints, diffusion models, text encoders and VAEs. Choose a profile in Composer to generate.",
    icon: Boxes,
    admin: true,
    group: "Administration",
  },
  profiles: {
    label: "Profiles",
    description: "Shared generation profiles and workflows. Every saved version is kept.",
    icon: FileCog,
    admin: true,
    group: "Administration",
  },
  promptStyles: {
    label: "Prompt Styles",
    description:
      "Shared assistant styles and templates for Improve Prompt, Animate and Edit. Every saved version is kept.",
    icon: icons.assistant,
    admin: true,
    group: "Administration",
  },
  unused: {
    label: "Unused",
    description: "Models no profile uses and LoRAs no run used in 90 days, with their sizes.",
    icon: ArchiveX,
    admin: true,
    group: "Administration",
  },
};
/** Administrators see the whole Library; other accounts only their cards and Presets. */
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
