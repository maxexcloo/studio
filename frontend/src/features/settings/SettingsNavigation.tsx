import {
  Boxes,
  FileCog,
  Info,
  Server,
  Shield,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  Wrench,
} from "lucide-react";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";

const settingSections = {
  account: {
    label: "Account",
    description: "Your role, sign-in details and personal MCP access.",
    icon: UserRound,
  },
  groups: {
    label: "Groups",
    description:
      "Access groups choose each user’s local models, cloud models and uncensored access; administrators have every permission.",
    icon: Shield,
    admin: true,
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
    icon: SlidersHorizontal,
  },
  users: {
    label: "Users",
    description: "Accounts, their access groups, chat identities and the new-account policy.",
    icon: UsersRound,
    admin: true,
  },
  workers: {
    label: "Workers",
    description: "Text, image and video services and their current status.",
    icon: Server,
    admin: true,
  },
  maintenance: {
    label: "Maintenance",
    description: "Clean up the gallery and gather details for a bug report.",
    icon: Wrench,
  },
  about: {
    label: "About",
    description: "Version, licences and credits.",
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
export function SettingsTitle() {
  const { options } = useSettingsNavigation();
  return <WorkspaceSectionSelect label="Settings" sections={options} />;
}
