import { Alert, Stack, Switch } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { ComponentProps } from "react";

import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useAccount } from "../auth/AccountGate";
import { modelsQuery } from "../generation/GenerationProvider";
import { ProfileSelect } from "../generation/ProfilePicker";
import { TextModelSelect, textModelName } from "../generation/TextModelSelect";
import { DeleteFailedItems } from "./DeleteFailedItems";
import {
  type Flag,
  type Setting,
  deploymentQuery,
  lockedNote,
  useDeploymentSetting,
} from "./deployment";
import { GalleryPass } from "./GalleryPass";

/** Background features with a catch-up pass over the gallery, each a row in Catch Up. */
const passes: Record<string, Omit<ComponentProps<typeof GalleryPass>, "label">> = {
  STUDIO_FACE_CHECK: {
    route: "/api/gallery/faces",
    description: "Check existing gallery images for faces.",
    remaining: "to check",
    progressLabel: "Face Check Progress",
  },
  STUDIO_GALLERY_CAPTIONS: {
    route: "/api/gallery/captions",
    description: "Caption existing gallery images.",
    remaining: "to caption",
    progressLabel: "Caption Progress",
    scopeLabel: "Images to Caption",
  },
  STUDIO_IMAGE_SEARCH: {
    route: "/api/gallery/embeddings",
    description: "Index existing gallery images for search.",
    remaining: "to index",
    progressLabel: "Index Progress",
  },
};

/** Settings › Studio: Studio-wide defaults, the work Studio does on its own, and failed items. */
export function StudioSettings() {
  const multiUser = useAccount().data?.mode === "multi-user";
  const deployment = useQuery(deploymentQuery);
  const profiles = useQuery(modelsQuery).data?.profiles ?? [];
  const save = useDeploymentSetting();
  if (deployment.isPending) return <LoadingState label="Loading Studio" fill />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const { defaults, catalogue } = deployment.data;
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
  const passRows = catalogue.flatMap((flag) => {
    const info = passes[flag.key];
    if (!info) return [];
    const ownRoute =
      multiUser && flag.key === "STUDIO_GALLERY_CAPTIONS" ? `${info.route}/me` : undefined;
    return [<GalleryPass key={flag.key} {...info} label={flag.label} ownRoute={ownRoute} />];
  });
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
      <SettingGroup title="Background AI">{catalogue.map(flagRow)}</SettingGroup>
      {passRows.length > 0 && <SettingGroup title="Catch Up">{passRows}</SettingGroup>}
      <SettingGroup danger>
        <DeleteFailedItems />
      </SettingGroup>
    </Stack>
  );
}
