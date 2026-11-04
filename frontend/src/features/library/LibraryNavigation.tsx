import { BookOpen, Boxes, Compass, FileCog, HardDriveDownload, Import } from "lucide-react";
import { icons } from "../../ui/icons";
import { useIsAdmin } from "../auth/AccountGate";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";
import { useLibraryAccess } from "./useLibraryAccess";

// What the studio has, then where more comes from, each alphabetical; the Library opens on Models.
export const librarySections = {
  guides: {
    label: "Guides",
    description: "Prompting guides for profiles and families. Every saved version is kept.",
    icon: BookOpen,
    admin: true,
    group: "What You Have",
  },
  loras: {
    label: "LoRAs",
    description: "Style and subject adapters for compatible models.",
    icon: icons.loras,
    group: "What You Have",
  },
  models: {
    label: "Models",
    description: "Checkpoints, diffusion models, text encoders and VAEs, with their families.",
    icon: Boxes,
    group: "What You Have",
    initial: true,
  },
  profiles: {
    label: "Profiles",
    description: "Generation profiles and their workflows. Every saved version is kept.",
    icon: FileCog,
    admin: true,
    group: "What You Have",
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
  presets: {
    label: "Inspiration",
    description: "Saved prompts and settings to start from.",
    icon: Compass,
    admin: true,
    group: "Getting More",
  },
};
export function useLibraryNavigation() {
  const admin = useIsAdmin();
  const { presets } = useLibraryAccess();
  return {
    admin,
    imports: admin && presets,
    options: visibleSections(
      librarySections,
      admin,
      (key) => presets || (key !== "imports" && key !== "presets"),
    ),
  };
}
export function LibraryTitle() {
  const { options } = useLibraryNavigation();
  return <WorkspaceSectionSelect label="Library" sections={options} />;
}
