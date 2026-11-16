import { Alert, SegmentedControl, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import type { DreamOverride } from "../../../../shared/dream";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { deploymentQuery, lockedNote, useDeploymentSetting } from "./deployment";

const onOff = [
  { value: "true", label: "On" },
  { value: "false", label: "Off" },
];
const backends = [
  { value: "local", label: "Local" },
  { value: "cloud", label: "Cloud" },
];
const backendNote =
  "Uses ready models allowed for the account; waits if this backend is unavailable. Cloud needs access to a ready cloud model.";

/** Settings › Dream: the settings an administrator forces on every account. */
export function DreamAdministration() {
  const deployment = useQuery(deploymentQuery);
  const save = useDeploymentSetting();
  if (deployment.isPending) return <LoadingState label="Loading Dream" fill />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const row = (
    name: DreamOverride,
    label: string,
    description: string,
    choices: { value: string; label: string }[],
  ) => {
    const setting = deployment.data.dream[name];
    return (
      <SettingRow label={label} description={description + lockedNote(setting)}>
        <SegmentedControl
          role="radiogroup"
          aria-label={`Dream ${label}`}
          value={setting.value === null ? "account" : String(setting.value)}
          disabled={setting.locked}
          data={[{ value: "account", label: "Account's Choice" }, ...choices]}
          onChange={(value) =>
            save.mutate({
              key: setting.key,
              value: value === "account" ? null : choices === onOff ? value === "true" : value,
            })
          }
        />
      </SettingRow>
    );
  };
  return (
    <Stack gap="lg">
      <SettingGroup title="Overrides">
        {row("enabled", "Enabled", "Make new media from each account's taste.", onOff)}
        {row("imageBackend", "Images Run On", backendNote, backends)}
        {row("paused", "Paused", "Hold idle generation.", onOff)}
        {row(
          "spicy",
          "Spicy",
          "Allow explicit themes, only for accounts with Uncensored Models access.",
          onOff,
        )}
        {row("videoBackend", "Videos Run On", backendNote, backends)}
      </SettingGroup>
    </Stack>
  );
}
