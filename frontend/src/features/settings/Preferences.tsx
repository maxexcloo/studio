import { Button, SegmentedControl, Stack, Switch } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { icons } from "../../ui/icons";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useKeepRecentPrompts } from "../generation/PromptHistory";
import {
  type GalleryWorkPreference,
  preferencesQuery,
  useSavePreferences,
  useTileCaptions,
} from "./accountPreferences";
import { DeleteFailedItems } from "./DeleteFailedItems";

const galleryWorkChoices = [
  { value: "none", label: "None" },
  { value: "running", label: "In Progress" },
  { value: "queued", label: "Queued" },
];
/** Which unfinished work the gallery shows: none (unsaved), work in progress, or queued work too. */
function GalleryWork() {
  const status = useQuery(preferencesQuery).data;
  const save = useSavePreferences();
  if (!status) return null;
  return (
    <SettingRow
      wide
      label="Unfinished Work"
      description="Show generations in the gallery before they finish: none, those in progress, or queued ones too."
    >
      <SegmentedControl
        aria-label="Unfinished Work"
        fullWidth
        data={galleryWorkChoices}
        value={status.preferences.galleryWork || "none"}
        onChange={(choice) => save.mutate({ galleryWork: choice as GalleryWorkPreference })}
      />
    </SettingRow>
  );
}

/** Settings › Preferences: how Studio works for this account, saved with it. */
export function Preferences() {
  const keep = useKeepRecentPrompts(true);
  const [tileCaptions, setTileCaptions] = useTileCaptions();
  const loaded = useQuery(preferencesQuery).isSuccess;
  return (
    <Stack gap="lg">
      {/* Settings run A–Z, then Export. */}
      <SettingGroup title="Gallery">
        <SettingRow
          label="Tile Captions"
          description="Show each tile's title and details on phones. Desktop shows them on hover."
        >
          <Switch
            key={loaded ? "loaded" : "loading"}
            aria-label="Tile Captions"
            checked={tileCaptions}
            disabled={!loaded}
            onChange={(event) => setTileCaptions(event.currentTarget.checked)}
          />
        </SettingRow>
        <GalleryWork />
        <SettingRow
          label="Export Gallery"
          description="Download every finished image and video as one ZIP."
        >
          <Button
            component="a"
            href="/api/gallery/export"
            download
            size="compact-sm"
            variant="default"
            leftSection={<icons.download size={16} />}
          >
            Export
          </Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Prompts">
        <SettingRow
          label="Keep Recent Prompts"
          description="Offer your recent prompts in the composer's history. Pinned prompts stay either way."
        >
          <Switch
            // Remounts once loaded so the saved state appears without the thumb sliding.
            key={keep.history.data ? "loaded" : "loading"}
            aria-label="Keep Recent Prompts"
            checked={!!keep.history.data?.enabled}
            disabled={!keep.history.data}
            onChange={(event) => keep.change.mutate(event.currentTarget.checked)}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Danger Zone" danger>
        <DeleteFailedItems />
      </SettingGroup>
    </Stack>
  );
}
