import { Boxes, Route, Server, Shield, UsersRound, Wrench } from "lucide-react";

import { icons } from "../../ui/icons";
import {
  WorkspaceSectionSelect,
  useWorkspaceSection,
  visibleSections,
} from "../../ui/WorkspaceSections";
import { useAccount, useGroupFeature, useIsAdmin } from "../auth/AccountGate";

// Personal sections, then administration, each alphabetical, with About last.
const settingSections = {
  account: {
    label: "Account",
    description: "Your sign-in details and personal MCP access.",
    icon: icons.account,
    group: "Personal",
  },
  dream: {
    label: "Dream",
    description: "What Dream makes for you and where it runs.",
    icon: icons.dream,
    group: "Personal",
  },
  preferences: {
    label: "Preferences",
    description: "Gallery, model access and prompt history preferences.",
    icon: icons.settings,
    group: "Personal",
  },
  "where-work-runs": {
    label: "Where Work Runs",
    description: "Choose default models and where images, videos and text run.",
    icon: Route,
    group: "Personal",
  },
  "dream-policy": {
    label: "Dream",
    description: "Shared queue rules and Dream overrides for all accounts.",
    icon: icons.dream,
    admin: true,
    group: "Administration",
  },
  generation: {
    label: "Generation",
    description: "Default profiles and failed items across all accounts.",
    icon: Boxes,
    admin: true,
    group: "Administration",
  },
  groups: {
    label: "Groups",
    description: "Model and feature access for each group.",
    icon: Shield,
    admin: true,
    group: "Administration",
  },
  maintenance: {
    label: "Maintenance",
    description: "Background AI, gallery maintenance and unfinished items.",
    icon: Wrench,
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
    icon: icons.details,
    apart: true,
  },
};
const multiUserOnly = new Set(["groups", "users"]);
export function useSettingsNavigation() {
  const multi = useAccount().data?.mode === "multi-user";
  const admin = useIsAdmin();
  const dream = useGroupFeature("dream");
  return {
    admin,
    multi,
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
