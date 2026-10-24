import { Info, Server, UserRound, UsersRound } from "lucide-react";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import { WorkspaceSectionSelect, visibleSections } from "../../ui/WorkspaceSections";

const settingSections = {
  account: {
    label: "Account",
    description: "Your role, sign-in details and personal MCP access.",
    icon: UserRound,
  },
  accounts: {
    label: "Accounts",
    description:
      "Access groups control each user’s local models, cloud models and NSFW access; administrators have all permissions.",
    icon: UsersRound,
    admin: true,
  },
  workers: {
    label: "Workers",
    description: "Text, image and video services and their current status.",
    icon: Server,
    admin: true,
  },
  about: { label: "About", description: "Credits and licences.", icon: Info },
};
export function useSettingsNavigation() {
  const multi = useAccount().data?.mode === "multi-user";
  const admin = useIsAdmin();
  return {
    admin,
    multi,
    options: visibleSections(settingSections, admin, (key) => key !== "accounts" || multi),
  };
}
export function SettingsTitle() {
  const { options } = useSettingsNavigation();
  return <WorkspaceSectionSelect label="Settings" sections={options} />;
}
