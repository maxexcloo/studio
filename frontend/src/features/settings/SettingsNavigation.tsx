import { Boxes, Info, Plug, Server, Shield, UserRound, UsersRound } from "lucide-react";
import { icons } from "../../ui/icons";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import {
  WorkspaceSectionSelect,
  useWorkspaceSection,
  visibleSections,
} from "../../ui/WorkspaceSections";

// Personal sections, then administration, each alphabetical, with About apart at the end.
const settingSections = {
  account: {
    label: "Account",
    description: "Your sign-in details and personal MCP access.",
    icon: UserRound,
    group: "Personal",
  },
  preferences: {
    label: "Preferences",
    description: "How Studio works for you, saved with your account.",
    icon: icons.settings,
    group: "Personal",
  },
  generation: {
    label: "Generation",
    description: "Default profiles, catalogue features and gallery passes for everyone.",
    icon: Boxes,
    admin: true,
    group: "Administration",
  },
  groups: {
    label: "Groups",
    description:
      "Which models, uncensored content, Chat and Dream each group can use; administrators can use everything.",
    icon: Shield,
    admin: true,
    group: "Administration",
  },
  integrations: {
    label: "Integrations",
    description: "Civitai, Hugging Face and the prompt assistant.",
    icon: Plug,
    admin: true,
    group: "Administration",
  },
  users: {
    label: "Users",
    description: "Accounts, their roles and groups, linked chat identities and the default group.",
    icon: UsersRound,
    admin: true,
    group: "Administration",
  },
  workers: {
    label: "Workers",
    description: "Text, image and video services and their current status.",
    icon: Server,
    admin: true,
    group: "Administration",
  },
  about: {
    label: "About",
    description: "Version, help, licences and credits.",
    icon: Info,
    apart: true,
  },
};
const multiUserOnly = new Set(["groups", "users"]);
export function useSettingsNavigation() {
  const multi = useAccount().data?.mode === "multi-user";
  const admin = useIsAdmin();
  return {
    admin,
    multi,
    options: visibleSections(settingSections, admin, (key) => multi || !multiUserOnly.has(key)),
  };
}
/** The open Settings section, or "" outside Settings. */
export function useSettingsSection() {
  const { options } = useSettingsNavigation();
  const { location, active } = useWorkspaceSection(options);
  return location.pathname === "/settings" ? active : "";
}
export function SettingsTitle() {
  const { options } = useSettingsNavigation();
  return <WorkspaceSectionSelect label="Settings" sections={options} />;
}
