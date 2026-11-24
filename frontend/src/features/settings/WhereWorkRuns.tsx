import { SegmentedControl, Select, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { dreamVideoSeconds } from "../../../../shared/dream";
import {
  grokVideoAspects,
  imageAspects,
  maxImageCount,
  resolutions,
  videoResolutions,
} from "../../../../shared/resolution";
import { LoadFailed } from "../../ui/LoadFailed";
import { LoadingState } from "../../ui/LoadingState";
import { plural } from "../../ui/plural";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { modelsQuery } from "../generation/GenerationProvider";
import { ProfileSelect } from "../generation/ProfilePicker";
import { TextModelSelect, textModelName } from "../generation/TextModelSelect";
import {
  type Setting,
  type WorkValues,
  deploymentQuery,
  lockedNote,
  useDeploymentSetting,
} from "./deployment";

/** The choice of none, listed first: each model keeps its own default. */
const profileDefault = { value: "", label: "Default (Model)" };
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
  const set = (name: keyof WorkValues, value: string | number | null) =>
    save.mutate({ key: work[name].key, value });
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
  /** A choice from `choices`, or the profile's own default. */
  const choiceRow = (
    name: "imageAspect" | "imageResolution" | "videoAspect" | "videoResolution",
    label: string,
    description: string,
    choices: readonly string[],
  ) => (
    <SettingRow wide label={label} description={description + lockedNote(work[name])}>
      <Select
        aria-label={label}
        data={[profileDefault, ...choices]}
        value={work[name].value ?? ""}
        allowDeselect={false}
        disabled={work[name].locked}
        onChange={(choice) => set(name, choice || null)}
      />
    </SettingRow>
  );
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
        onChange={(side) => set(name, side)}
      />
    </SettingRow>
  );
  return (
    <Stack gap="lg">
      <SettingGroup title="Images">
        {modelRow("image", defaults.image)}
        {choiceRow(
          "imageAspect",
          "Default Aspect",
          "The starting shape for new image drafts and chat runs, where the model supports it.",
          imageAspects,
        )}
        <SettingRow
          wide
          label="Default Count"
          description={`How many images new drafts and chat runs make, where the model can.${lockedNote(work.imageCount)}`}
        >
          <Select
            aria-label="Default Count"
            data={[
              profileDefault,
              ...Array.from({ length: maxImageCount }, (_, index) => ({
                value: String(index + 1),
                label: plural(index + 1, "Image"),
              })),
            ]}
            value={work.imageCount.value ? String(work.imageCount.value) : ""}
            allowDeselect={false}
            disabled={work.imageCount.locked}
            onChange={(choice) => set("imageCount", choice ? Number(choice) : null)}
          />
        </SettingRow>
        {choiceRow(
          "imageResolution",
          "Default Resolution",
          "The starting resolution for new image drafts and chat runs, where the model supports it.",
          resolutions,
        )}
      </SettingGroup>
      <SettingGroup title="Videos">
        {modelRow("video", defaults.video)}
        <SettingRow
          wide
          label="Video Length"
          description={`How long new video drafts and Dream's videos run; Animate starts here until someone picks a length in its menu. Each model keeps to the lengths it allows.${lockedNote(work.videoSeconds)}`}
        >
          <SegmentedControl
            role="radiogroup"
            aria-label="Video Length"
            fullWidth
            value={String(work.videoSeconds.value ?? 0)}
            disabled={work.videoSeconds.locked}
            data={dreamVideoSeconds.map((seconds) => ({
              value: String(seconds),
              label: seconds ? `${seconds} s` : "Auto",
            }))}
            onChange={(value) => set("videoSeconds", Number(value) || null)}
          />
        </SettingRow>
        {choiceRow(
          "videoAspect",
          "Default Aspect",
          "The starting shape for new video drafts. A start frame can override it.",
          grokVideoAspects,
        )}
        {choiceRow(
          "videoResolution",
          "Default Resolution",
          "The starting resolution for new video drafts and Animate.",
          videoResolutions,
        )}
      </SettingGroup>
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
