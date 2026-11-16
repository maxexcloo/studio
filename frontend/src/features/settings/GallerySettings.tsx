import { Alert, Stack, Switch } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { type Flag, deploymentQuery, lockedNote, useDeploymentSetting } from "./deployment";
import { GalleryPass } from "./GalleryPass";
import { UnfinishedItems } from "./UnfinishedItems";

/** Settings › Gallery: Background AI switches and gallery passes. */
export function GallerySettings() {
  const deployment = useQuery(deploymentQuery);
  const save = useDeploymentSetting();
  if (deployment.isPending) return <LoadingState label="Loading Gallery" fill />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const { catalogue } = deployment.data;
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
  // The gallery passes' switch sits with them under Gallery, whose rows run A–Z by label.
  const whileBusy = catalogue.find((flag) => flag.key === "STUDIO_GALLERY_WHILE_BUSY");
  // The rest are Background AI, A–Z as deployment-settings.js lists them.
  const background = catalogue.filter((flag) => flag !== whileBusy);
  return (
    <Stack gap="lg">
      {background.length > 0 && (
        <SettingGroup title="Background AI">{background.map(flagRow)}</SettingGroup>
      )}
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
          route="/api/gallery/faces"
          label="Check Faces"
          description="Compare images made with a character with the character's image by face, on the CPU while Studio is idle. The first run downloads the models."
          remaining="to check"
          progressLabel="Face Check Progress"
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
