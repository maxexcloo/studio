import {
  BookOpen,
  Boxes,
  Download,
  HardDriveDownload,
  Layers,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { useAccount } from "../auth/AccountGate";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";
import { useLibraryAccess } from "./useLibraryAccess";

export const librarySections = {
  imports: {
    label: "Imports",
    description:
      "Import a Civitai or Hugging Face link, or an image, and review its compatibility.",
    icon: Download,
    admin: true,
  },
  presets: {
    label: "Inspiration",
    description: "Saved prompts and settings to start new work from.",
    icon: Sparkles,
    admin: true,
  },
  models: {
    label: "Models",
    description: "Base models installed or available to download.",
    icon: Boxes,
  },
  loras: {
    label: "LoRAs",
    description: "Style and subject adapters for compatible models.",
    icon: Layers,
  },
  downloads: {
    label: "Downloads",
    description: "Model downloads in progress and recently finished.",
    icon: HardDriveDownload,
    admin: true,
  },
  profiles: {
    label: "Profiles",
    description:
      "Generation profiles that connect models to workflows. Every saved version is kept.",
    icon: SlidersHorizontal,
    admin: true,
  },
  guides: {
    label: "Guides",
    description: "Prompting guides for the prompt assistant. Every saved version is kept.",
    icon: BookOpen,
    admin: true,
  },
};
export function useLibraryNavigation() {
  const account = useAccount();
  const { presets } = useLibraryAccess();
  const admin =
    !!account.data &&
    (account.data.mode !== "multi-user" || account.data.account?.role === "administrator");
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
