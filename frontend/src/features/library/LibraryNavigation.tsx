import { useAccount } from "../auth/AccountGate";
import { WorkspaceSectionSelect } from "../../ui/WorkspaceSections";

export const librarySections = {
  imports: { value: "imports", label: "Imports" },
  presets: { value: "presets", label: "Inspiration" },
  models: { value: "models", label: "Models" },
  loras: { value: "loras", label: "LoRAs" },
  profiles: { value: "profiles", label: "Profiles" },
  guides: { value: "guides", label: "Guides" },
};
export function useLibraryNavigation() {
  const account = useAccount();
  const admin =
    !!account.data &&
    (account.data.mode !== "multi-user" || account.data.account?.role === "administrator");
  return {
    admin,
    options: Object.values(librarySections).filter(
      (section) => admin || !["profiles", "guides"].includes(section.value),
    ),
  };
}
export function LibraryTitle() {
  const { options } = useLibraryNavigation();
  return <WorkspaceSectionSelect label="Library" sections={options} />;
}
