import { useAccount } from "../auth/AccountGate";
import { WorkspaceSectionSelect } from "../../ui/WorkspaceSections";
import { useLibraryAccess } from "./useLibraryAccess";

export const librarySections = {
  imports: { value: "imports", label: "Imports" },
  presets: { value: "presets", label: "Inspiration" },
  models: { value: "models", label: "Models" },
  loras: { value: "loras", label: "LoRAs" },
  downloads: { value: "downloads", label: "Downloads" },
  profiles: { value: "profiles", label: "Profiles" },
  guides: { value: "guides", label: "Guides" },
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
    options: Object.values(librarySections).filter((section) =>
      ["imports", "presets"].includes(section.value)
        ? admin && presets
        : admin || !["downloads", "profiles", "guides"].includes(section.value),
    ),
  };
}
export function LibraryTitle() {
  const { options } = useLibraryNavigation();
  return <WorkspaceSectionSelect label="Library" sections={options} />;
}
