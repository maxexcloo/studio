import { icons } from "../../ui/icons";
import {
  WorkspaceSectionSelect,
  useWorkspaceSection,
  visibleSections,
} from "../../ui/WorkspaceSections";
import { useAccount, useGroupFeature, useIsAdmin } from "../auth/AccountGate";

// Personal sections, then administration, each by how often it is used, with About last.
const settingSections = {
  preferences: {
    label: "Preferences",
    description:
      "Choose how the gallery looks, which models are offered and whether to keep prompts.",
    icon: icons.settings,
    group: "Personal",
  },
  "where-work-runs": {
    label: "Where Work Runs",
    description: "Choose where your work runs and the models and image sizes it starts with.",
    icon: icons.routing,
    group: "Personal",
  },
  taste: {
    label: "Taste",
    description:
      "Choose where your taste applies, your own preferences and exclusions, and steer what Studio learnt.",
    icon: icons.taste,
    group: "Personal",
  },
  dream: {
    label: "Dream",
    description: "Choose what Dream makes for you and how much it can make each day.",
    icon: icons.dream,
    group: "Personal",
  },
  account: {
    label: "Account",
    description: "Manage how you sign in and connect MCP clients to your account.",
    icon: icons.account,
    group: "Personal",
  },
  workers: {
    label: "Workers",
    description: "Manage worker placement, service health and unfinished jobs.",
    icon: icons.workers,
    admin: true,
    group: "Administration",
  },
  studio: {
    label: "Studio",
    description: "Set Studio-wide defaults, the AI work Studio does on its own, and failed items.",
    icon: icons.studio,
    admin: true,
    group: "Administration",
  },
  "dream-policy": {
    label: "Dream",
    description: "Choose which Dream settings accounts can change and when Dream can start jobs.",
    icon: icons.dream,
    admin: true,
    group: "Administration",
  },
  users: {
    label: "Users",
    description: "Manage accounts and linked chat identities.",
    icon: icons.users,
    admin: true,
    group: "Administration",
  },
  groups: {
    label: "Groups",
    description: "Choose the models and features each access group can use, and the default group.",
    icon: icons.group,
    admin: true,
    group: "Administration",
  },
  about: {
    label: "About",
    description: "Find this deployment's version, diagnostics, documentation and project credits.",
    icon: icons.details,
    apart: true,
  },
};
const multiUserOnly = new Set(["account", "groups", "users"]);
export function useSettingsNavigation() {
  const multi = useAccount().data?.mode === "multi-user";
  const admin = useIsAdmin();
  const dream = useGroupFeature("dream");
  return {
    admin,
    options: visibleSections(
      settingSections,
      admin,
      (key) => (multi || !multiUserOnly.has(key)) && (key !== "dream" || dream),
    ),
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
