import { ArchiveX, BookOpen, Boxes, FileCog, HardDriveDownload, Import } from "lucide-react";
import { icons } from "../../ui/icons";
import { useIsAdmin } from "../auth/AccountGate";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";
import { useLibraryAccess } from "./useLibraryAccess";

// Grouped as the navigation lists them, each group alphabetical; the Library opens on Models.
export const librarySections = {
  characters: {
    label: "Characters",
    description:
      "Your character cards: an image and lasting looks that picking one leads a prompt with.",
    icon: icons.character,
    group: "Cards",
  },
  outfits: {
    label: "Outfits",
    description: "Outfits to dress a character in, the same across a series of shots.",
    icon: icons.outfit,
    group: "Cards",
  },
  scenes: {
    label: "Scenes",
    description: "Places, light and time of day to reuse across a series of shots.",
    icon: icons.scene,
    group: "Cards",
  },
  loras: {
    label: "LoRAs",
    description: "Style and subject adapters for compatible models.",
    icon: icons.loras,
    group: "Catalogue",
  },
  models: {
    label: "Models",
    description: "Checkpoints, diffusion models, text encoders and VAEs, with their families.",
    icon: Boxes,
    group: "Catalogue",
    initial: true,
  },
  unused: {
    label: "Unused",
    description: "Models no profile uses and LoRAs no run used in 90 days, with their sizes.",
    icon: ArchiveX,
    admin: true,
    group: "Catalogue",
  },
  guides: {
    label: "Guides",
    description: "Prompting guides for profiles and families. Every saved version is kept.",
    icon: BookOpen,
    admin: true,
    group: "Generation",
  },
  profiles: {
    label: "Profiles",
    description: "Generation profiles and their workflows. Every saved version is kept.",
    icon: FileCog,
    admin: true,
    group: "Generation",
  },
  downloads: {
    label: "Downloads",
    description: "Current and recent model downloads. Stopping keeps partial files to resume.",
    icon: HardDriveDownload,
    admin: true,
    group: "Getting More",
  },
  imports: {
    label: "Imports",
    description:
      "Import a Civitai or Hugging Face link, or an image, and review its compatibility.",
    icon: Import,
    admin: true,
    group: "Getting More",
  },
};
/** Administrators see the whole Library; other accounts only their Characters, Outfits and Scenes. */
export function useLibraryNavigation() {
  const admin = useIsAdmin();
  const { characters } = useLibraryAccess();
  return {
    admin,
    options: visibleSections(librarySections, admin, (key) =>
      ["characters", "outfits", "scenes"].includes(key) ? characters : admin,
    ),
  };
}
export function LibraryTitle() {
  const { options } = useLibraryNavigation();
  return <WorkspaceSectionSelect label="Library" sections={options} />;
}
