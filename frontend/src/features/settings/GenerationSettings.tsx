import { Alert, Select, Stack, Switch } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import {
  deploymentQuery,
  lockedNote,
  useDeploymentSetting,
  type Flag,
  type Setting,
} from "./deployment";
import { GalleryPass } from "./GalleryPass";
import { UnfinishedItems } from "./UnfinishedItems";

/** Settings › Generation: default profiles, Background AI switches and gallery passes. */
export function GenerationSettings() {
  const deployment = useQuery(deploymentQuery);
  const save = useDeploymentSetting();
  if (deployment.isPending) return <LoadingState label="Loading Generation" fill />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const { defaults, catalogue } = deployment.data;
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
          w={{ base: "100%", sm: 240 }}
        />
      </SettingRow>
    );
  };
  const flagRow = (flag: Flag) => (
    <SettingRow
      key={flag.key}
      label={flag.label}
      description={`${flag.description}${lockedNote(flag)}`}
    >
      <Switch
        aria-label={flag.label}
        checked={flag.value}
        disabled={flag.locked}
        onChange={(event) => save.mutate({ key: flag.key, value: event.currentTarget.checked })}
      />
    </SettingRow>
  );
  // The gallery passes' switch sits with them under Gallery.
  const whileBusy = catalogue.find((flag) => flag.key === "STUDIO_GALLERY_WHILE_BUSY");
  // The rest are Background AI, A–Z as deployment-settings.js lists them.
  const background = catalogue.filter((flag) => flag !== whileBusy);
  return (
    <Stack gap="lg">
      {background.length > 0 && (
        <SettingGroup title="Background AI">{background.map(flagRow)}</SettingGroup>
      )}
      <SettingGroup title="Defaults">
        {profileSelect("image", defaults.image)}
        {profileSelect("video", defaults.video)}
      </SettingGroup>
      <SettingGroup title="Gallery">
        <GalleryPass
          route="/api/gallery/captions"
          label="Caption Gallery"
          description="Describe and tag images for search while Studio is idle. Out of Date covers missing captions and those from older rules."
          remaining="to caption"
          progressLabel="Caption Progress"
          scopeLabel="Images to Caption"
        />
        <GalleryPass
          route="/api/gallery/embeddings"
          label="Index Gallery"
          description="Index every image for Image Search on the CPU while Studio is idle. The first run downloads the model."
          remaining="to index"
          progressLabel="Index Progress"
        />
        {whileBusy && flagRow(whileBusy)}
        <UnfinishedItems />
      </SettingGroup>
    </Stack>
  );
}
