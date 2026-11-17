import { Alert, Select, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useAccount } from "../auth/AccountGate";
import { DeleteFailedItems } from "./DeleteFailedItems";
import { type Setting, deploymentQuery, lockedNote, useDeploymentSetting } from "./deployment";

/** Settings › Generation: the default profiles, and every account's failed items. */
export function GenerationSettings() {
  const deployment = useQuery(deploymentQuery);
  const save = useDeploymentSetting();
  const multiUser = useAccount().data?.mode === "multi-user";
  if (deployment.isPending) return <LoadingState label="Loading Generation" fill />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const { defaults } = deployment.data;
  const profileSelect = (kind: "image" | "video", setting: Setting) => {
    const label = kind === "image" ? "Default Image Profile" : "Default Video Profile";
    const options = defaults.profiles.filter((profile) => profile.kind === kind);
    const effective = options.find((profile) => profile.id === setting.effective);
    return (
      <SettingRow
        wide
        label={label}
        description={`New drafts start on ${effective?.label || "the first ready profile"}.${lockedNote(setting)}`}
      >
        <Select
          aria-label={label}
          placeholder="First Ready Profile"
          data={options.map((profile) => ({
            value: profile.id,
            label: profile.ready ? profile.label : `${profile.label} (Not Ready)`,
          }))}
          value={setting.configured || null}
          onChange={(value) => save.mutate({ key: setting.key, value: value || "" })}
          disabled={setting.locked}
          searchable
          clearable
          nothingFoundMessage="No Matches"
        />
      </SettingRow>
    );
  };
  return (
    <Stack gap="lg">
      <SettingGroup title="Defaults">
        {profileSelect("image", defaults.image)}
        {profileSelect("video", defaults.video)}
      </SettingGroup>
      {multiUser && (
        <SettingGroup title="Danger Zone" danger>
          <DeleteFailedItems others />
        </SettingGroup>
      )}
    </Stack>
  );
}
