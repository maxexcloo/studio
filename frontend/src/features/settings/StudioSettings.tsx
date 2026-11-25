import { Alert, Stack, Switch } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { ComponentProps } from "react";

import { compareNames } from "../../ui/DataTable";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useAccount } from "../auth/AccountGate";
import { DeleteFailedItems } from "./DeleteFailedItems";
import { type Flag, deploymentQuery, lockedNote, useDeploymentSetting } from "./deployment";
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

/** Settings › Studio: the work Studio does on its own, and failed items. */
export function StudioSettings() {
  const multiUser = useAccount().data?.mode === "multi-user";
  const deployment = useQuery(deploymentQuery);
  const save = useDeploymentSetting();
  if (deployment.isPending) return <LoadingState label="Loading Studio" fill />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const catalogue = [...deployment.data.catalogue].sort((a, b) => compareNames(a.label, b.label));
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
      <SettingGroup title="Background AI">{catalogue.map(flagRow)}</SettingGroup>
      {passRows.length > 0 && <SettingGroup title="Catch Up">{passRows}</SettingGroup>}
      <SettingGroup danger>
        <DeleteFailedItems />
      </SettingGroup>
    </Stack>
  );
}
