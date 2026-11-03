import {
  Boxes,
  FileCog,
  Info,
  MessagesSquare,
  Server,
  Shield,
  UserRound,
  UsersRound,
  Wrench,
} from "lucide-react";
import { icons } from "../../ui/icons";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";

// Alphabetical, with About apart at the end.
const settingSections = {
  account: {
    label: "Account",
    description: "Your role, sign-in details and personal MCP access.",
    icon: UserRound,
  },
  gateway: {
    label: "Chat Gateway",
    description: "Chat identities linked to Studio accounts, and the gateway's admin tools.",
    icon: MessagesSquare,
    admin: true,
  },
  groups: {
    label: "Groups",
    description:
      "Which local models, cloud models and uncensored content each group can use; administrators can use everything.",
    icon: Shield,
    admin: true,
  },
  maintenance: {
    label: "Maintenance",
    description: "Clean up the gallery and gather details for a bug report.",
    icon: Wrench,
  },
  models: {
    label: "Models",
    description: "Default profiles, catalogue features and integrations.",
    icon: Boxes,
    admin: true,
  },
  profiles: {
    label: "Profiles",
    description: "Generation profiles and prompting guides. Every saved version is kept.",
    icon: FileCog,
    admin: true,
  },
  studio: {
    label: "Studio",
    description: "How Studio works for you.",
    icon: icons.settings,
  },
  users: {
    label: "Users",
    description: "Accounts, their access groups and the new-account policy.",
    icon: UsersRound,
    admin: true,
  },
  workers: {
    label: "Workers",
    description: "Text, image and video services and their current status.",
    icon: Server,
    admin: true,
  },
  about: {
    label: "About",
    description: "Version, licences and credits.",
    icon: Info,
    apart: true,
  },
};
const multiUserOnly = new Set(["gateway", "groups", "users"]);
export function useSettingsNavigation() {
  const multi = useAccount().data?.mode === "multi-user";
  const admin = useIsAdmin();
  return {
    admin,
    multi,
    options: visibleSections(settingSections, admin, (key) => multi || !multiUserOnly.has(key)),
  };
}
export function SettingsTitle() {
  const { options } = useSettingsNavigation();
  return <WorkspaceSectionSelect label="Settings" sections={options} />;
}
