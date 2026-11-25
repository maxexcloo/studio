import { SegmentedControl, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { LoadFailed } from "../../ui/LoadFailed";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { modelsQuery } from "../generation/GenerationProvider";
import { ProfileSelect } from "../generation/ProfilePicker";
import { TextModelSelect, textModelName } from "../generation/TextModelSelect";
import { type Setting, deploymentQuery, lockedNote, useDeploymentSetting } from "./deployment";

const sides = [
  { value: "cloud", label: "Cloud" },
  { value: "local", label: "Local" },
];

/**
 * Settings › Where Work Runs: how new work starts for everyone. Each kind's default model decides
 * where it runs, giving way to the other side when that can't; a model someone picks in the
 * composer, or a length they choose in Animate, still wins for them.
 */
export function WhereWorkRuns() {
  const deployment = useQuery(deploymentQuery);
  const profiles = useQuery(modelsQuery).data?.profiles ?? [];
  const save = useDeploymentSetting();
  if (!deployment.data)
    return deployment.error ? (
      <LoadFailed error={deployment.error}>Couldn't Load Where Work Runs</LoadFailed>
    ) : (
      <LoadingState fill label="Loading Where Work Runs" />
    );
  const { defaults, work } = deployment.data;
  const modelRow = (kind: "image" | "video", setting: Setting) => {
    const offered = defaults.profiles.filter((profile) => profile.kind === kind);
    const effective = offered.find((profile) => profile.id === setting.effective);
    return (
      <SettingRow
        wide
        label="Default Model"
        description={`New drafts, chat runs and Dream start on ${effective?.label || "the first ready model"}, which also decides whether ${kind}s run locally or in the cloud.${lockedNote(setting)}`}
      >
        <ProfileSelect
          field
          name={`Default ${kind === "image" ? "Image" : "Video"} Model`}
          unset="Default (First Ready)"
          profiles={profiles.filter((profile) => offered.some((item) => item.id === profile.id))}
          value={setting.configured || null}
          onChange={(profile) => save.mutate({ key: setting.key, value: profile?.id ?? "" })}
          disabled={setting.locked}
        />
      </SettingRow>
    );
  };
  const dreamRow = (name: "dreamImageBackend" | "dreamVideoBackend", label: string) => (
    <SettingRow
      wide
      label={label}
      description={`Where Dream's ${label.toLowerCase()} run; Dream waits while that side is unavailable.${lockedNote(work[name])}`}
    >
      <SegmentedControl
        role="radiogroup"
        aria-label={`Dream ${label}`}
        fullWidth
        data={sides}
        value={work[name].value}
        disabled={work[name].locked}
        onChange={(side) => save.mutate({ key: work[name].key, value: side })}
      />
    </SettingRow>
  );
  return (
    <Stack gap="lg">
      <SettingGroup title="Images">{modelRow("image", defaults.image)}</SettingGroup>
      <SettingGroup title="Videos">{modelRow("video", defaults.video)}</SettingGroup>
      <SettingGroup title="Dream">
        {dreamRow("dreamImageBackend", "Images")}
        {dreamRow("dreamVideoBackend", "Videos")}
      </SettingGroup>
      <SettingGroup title="Text">
        <SettingRow
          wide
          label="Default Model"
          description={
            (defaults.text.effective
              ? `Prompt writing and other text work use ${textModelName(defaults.text.effective)}, which also decides whether text runs locally or in the cloud.`
              : "The model for prompt writing and other text work.") + lockedNote(defaults.text)
          }
        >
          <TextModelSelect
            name="Default Text Model"
            models={defaults.textModels}
            unset="Default (Gateway)"
            value={defaults.text.configured || null}
            onChange={(model) => save.mutate({ key: defaults.text.key, value: model ?? "" })}
            disabled={
              defaults.text.locked || (!defaults.textModels.length && !defaults.text.configured)
            }
          />
        </SettingRow>
      </SettingGroup>
    </Stack>
  );
}
