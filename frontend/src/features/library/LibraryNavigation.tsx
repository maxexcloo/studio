import { ArchiveX, BookOpen, Boxes, FileCog, HardDriveDownload, Import } from "lucide-react";

import { icons } from "../../ui/icons";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";
import { useIsAdmin } from "../auth/AccountGate";
import { useLibraryAccess } from "./useLibraryAccess";

// Groups run from the most used; Your Cards and Prompting list A–Z, Models & LoRAs lead with their
// names and Add Models follows an import to its downloads. The Library opens on Models.
export const librarySections = {
  characters: {
    label: "Characters",
    description:
      "Your character cards: an image and lasting looks that picking one leads a prompt with.",
    icon: icons.character,
    group: "Your Cards",
  },
  outfits: {
    label: "Outfits",
    description: "Outfits to dress a character in, the same across a series of shots.",
    icon: icons.outfit,
    group: "Your Cards",
  },
  scenes: {
    label: "Scenes",
    description: "Places, light and time of day to reuse across a series of shots.",
    icon: icons.scene,
    group: "Your Cards",
  },
  models: {
    label: "Models",
    description: "Checkpoints, diffusion models, text encoders and VAEs, with their families.",
    icon: Boxes,
    group: "Models & LoRAs",
    initial: true,
  },
  loras: {
    label: "LoRAs",
    description: "Style and subject adapters for compatible models.",
    icon: icons.loras,
    group: "Models & LoRAs",
  },
  unused: {
    label: "Unused",
    description: "Models no profile uses and LoRAs no run used in 90 days, with their sizes.",
    icon: ArchiveX,
    admin: true,
    group: "Models & LoRAs",
  },
  guides: {
    label: "Guides",
    description: "Prompting guides for profiles and families. Every saved version is kept.",
    icon: BookOpen,
    admin: true,
    group: "Prompting",
  },
  presets: {
    label: "Presets",
    description:
      "Your saved presets: a prompt, model, settings or LoRAs to start from, or any mix of them.",
    icon: icons.preset,
    group: "Prompting",
  },
  profiles: {
    label: "Profiles",
    description: "Generation profiles and their workflows. Every saved version is kept.",
    icon: FileCog,
    admin: true,
    group: "Prompting",
  },
  promptStyles: {
    label: "Prompt Styles",
    description:
      "The assistant's fixed options: Improve Prompt's styles, Animate's themes and AI edits. Every saved version is kept.",
    icon: icons.assistant,
    admin: true,
    group: "Prompting",
  },
  imports: {
    label: "Imports",
    description:
      "Import a Civitai or Hugging Face link, or an image, and review its compatibility. Reddit posts' images go to Uploads.",
    icon: Import,
    admin: true,
    group: "Add Models",
  },
  downloads: {
    label: "Downloads",
    description: "Current and recent model downloads. Stopping keeps partial files to resume.",
    icon: HardDriveDownload,
    admin: true,
    group: "Add Models",
  },
};
/** Administrators see the whole Library; other accounts only their cards and Presets. */
export function useLibraryNavigation() {
  const admin = useIsAdmin();
  const { characters } = useLibraryAccess();
  return {
    admin,
    options: visibleSections(librarySections, admin, (key) =>
      ["characters", "outfits", "scenes"].includes(key) ? characters : key === "presets" || admin,
    ),
  };
}
export function LibraryTitle() {
  const { options } = useLibraryNavigation();
  return <WorkspaceSectionSelect label="Library" sections={options} />;
}
