import { useAccount } from "../auth/AccountGate";
import { WorkspaceSectionSelect } from "../../ui/WorkspaceSections";

export const settingSections = {
  account: { value: "account", label: "Account" },
  accounts: { value: "accounts", label: "Accounts" },
  workers: { value: "workers", label: "Workers" },
  about: { value: "about", label: "About" },
};
export function useSettingsNavigation() {
  const account = useAccount();
  const admin =
    account.data?.mode !== "multi-user" || account.data.account?.role === "administrator";
  const options = [
    settingSections.account,
    ...(admin && account.data?.mode === "multi-user" ? [settingSections.accounts] : []),
    ...(admin ? [settingSections.workers] : []),
    settingSections.about,
  ];
  return { account, admin, options };
}
export function SettingsTitle() {
  const { options } = useSettingsNavigation();
  return <WorkspaceSectionSelect label="Settings" sections={options} />;
}
