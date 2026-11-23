import { Alert, SegmentedControl, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import {
  type DreamOverride,
  type DreamTiming,
  maxDreamIdleMinutes,
} from "../../../../shared/dream";
import { LoadingState } from "../../ui/LoadingState";
import { NumberSetting } from "../../ui/NumberSetting";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { deploymentQuery, lockedNote, useDeploymentSetting } from "./deployment";

const onOff = [
  { value: "true", label: "On" },
  { value: "false", label: "Off" },
];
const backends = [
  { value: "cloud", label: "Cloud" },
  { value: "local", label: "Local" },
];
const backendNote =
  "Uses ready models allowed for the account; waits if this backend is unavailable. Cloud needs access to a ready cloud model.";

export function DreamAdministration() {
  const deployment = useQuery(deploymentQuery);
  const save = useDeploymentSetting();
  if (deployment.isPending) return <LoadingState label="Loading Dream Defaults" fill />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const delay = (name: DreamTiming, label: string, description: string) => {
    const setting = deployment.data.dream[name];
    return (
      <SettingRow label={label} description={description + lockedNote(setting)}>
        <NumberSetting
          key={setting.value}
          label={label}
          value={setting.value}
          min={0}
          max={maxDreamIdleMinutes}
          disabled={setting.locked}
          onSave={(value) => save.mutate({ key: setting.key, value })}
        />
      </SettingRow>
    );
  };
  const row = (
    name: DreamOverride,
    label: string,
    description: string,
    choices: { value: string; label: string }[],
  ) => {
    const setting = deployment.data.dream[name];
    return (
      <SettingRow wide label={label} description={description + lockedNote(setting)}>
        <SegmentedControl
          role="radiogroup"
          aria-label={`Dream ${label}`}
          fullWidth
          value={setting.value === null ? "account" : String(setting.value)}
          disabled={setting.locked}
          data={[{ value: "account", label: "Per Account" }, ...choices]}
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
      <SettingGroup title="Delays">
        {delay(
          "imageIdleMinutes",
          "Image Idle Delay",
          "Minutes after an account's latest generation request before Dream makes its images.",
        )}
        {delay(
          "videoIdleMinutes",
          "Video Idle Delay",
          "Minutes after an account's latest generation request before Dream makes its videos.",
        )}
        {delay(
          "imageSwitchMinutes",
          "Model & LoRA Switch Delay",
          "Minutes the shared queue must be idle before Dream loads a different local image model or LoRA set. Dream can reuse the loaded setup during this wait.",
        )}
      </SettingGroup>
      <SettingGroup title="Account Overrides">
        {row("enabled", "Enabled", "Make new media from each account's taste.", onOff)}
        {row(
          "uncensored",
          "Uncensored",
          "Allow explicit themes, only for accounts with Uncensored Models access.",
          onOff,
        )}
        {row("imageBackend", "Images", `Where Dream's images run. ${backendNote}`, backends)}
        {row("videoBackend", "Videos", `Where Dream's videos run. ${backendNote}`, backends)}
      </SettingGroup>
    </Stack>
  );
}
