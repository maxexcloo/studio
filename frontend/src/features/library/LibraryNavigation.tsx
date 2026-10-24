import { Boxes, Download, HardDriveDownload, Layers, Sparkles } from "lucide-react";
import { useIsAdmin } from "../auth/AccountGate";
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
    description: "Checkpoints, diffusion models, text encoders and VAEs, with their families.",
    icon: Boxes,
  },
  loras: {
    label: "LoRAs",
    description: "Style and subject adapters for compatible models.",
    icon: Layers,
  },
  downloads: {
    label: "Downloads",
    description:
      "Model downloads in progress and recently finished. Cancelling keeps partial files to resume.",
    icon: HardDriveDownload,
    admin: true,
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
