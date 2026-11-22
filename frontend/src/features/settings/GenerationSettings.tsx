import { Alert, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useAccount } from "../auth/AccountGate";
import { modelsQuery } from "../generation/GenerationProvider";
import { ProfileSelect } from "../generation/ProfilePicker";
import { TextModelSelect, textModelName } from "../generation/TextModelSelect";
import { DeleteFailedItems } from "./DeleteFailedItems";
import { type Setting, deploymentQuery, lockedNote, useDeploymentSetting } from "./deployment";

/** Settings › Generation: the default profiles and every account's failed items. */
export function GenerationSettings() {
  const deployment = useQuery(deploymentQuery);
  const profiles = useQuery(modelsQuery).data?.profiles ?? [];
  const save = useDeploymentSetting();
  const multiUser = useAccount().data?.mode === "multi-user";
  if (deployment.isPending) return <LoadingState label="Loading Generation" fill />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const { defaults } = deployment.data;
  const profileSelect = (kind: "image" | "video", setting: Setting) => {
    const label = kind === "image" ? "Image Profile" : "Video Profile";
    const offered = defaults.profiles.filter((profile) => profile.kind === kind);
    const effective = offered.find((profile) => profile.id === setting.effective);
    return (
      <SettingRow
        wide
        label={label}
        description={`New drafts start on ${effective?.label || "the first ready profile"}.${lockedNote(setting)}`}
      >
        <ProfileSelect
          field
          name={label}
          unset="First Ready Profile"
          profiles={profiles.filter((profile) => offered.some((item) => item.id === profile.id))}
          value={setting.configured || null}
          onChange={(profile) => save.mutate({ key: setting.key, value: profile?.id ?? "" })}
          disabled={setting.locked}
        />
      </SettingRow>
    );
  };
  return (
    <Stack gap="lg">
      <SettingGroup title="Defaults">
        {profileSelect("image", defaults.image)}
        {profileSelect("video", defaults.video)}
        <SettingRow
          wide
          label="Text Profile"
          description={
            (defaults.text.effective
              ? `Default for prompt writing and other text work. Uses ${textModelName(defaults.text.effective)} when available.`
              : "Default for prompt writing and other text work.") + lockedNote(defaults.text)
          }
        >
          <TextModelSelect
            name="Text Profile"
            models={defaults.textModels}
            unset="Gateway Default"
            value={defaults.text.configured || null}
            onChange={(model) => save.mutate({ key: defaults.text.key, value: model ?? "" })}
            disabled={
              defaults.text.locked || (!defaults.textModels.length && !defaults.text.configured)
            }
          />
        </SettingRow>
      </SettingGroup>
      {multiUser && (
        <SettingGroup title="Danger Zone" danger>
          <DeleteFailedItems others />
        </SettingGroup>
      )}
    </Stack>
  );
}
