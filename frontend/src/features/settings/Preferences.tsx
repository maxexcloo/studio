import { Button, SegmentedControl, Select, Stack, Switch } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { icons } from "../../ui/icons";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { assistantQuery } from "../generation/PromptAssistant";
import { useKeepRecentPrompts } from "../generation/PromptHistory";
import {
  type GalleryWorkPreference,
  type SidePreference,
  type VideosPreference,
  preferencesQuery,
  useSavePreferences,
  useTileCaptions,
} from "./accountPreferences";
import { DeleteFailedItems } from "./DeleteFailedItems";
import { FinishLikedImages } from "./FinishLikedImages";

type ModelChoice = "cloudModels" | "loras" | "uncensoredModels";
/** A switch for a model choice the account turns off for itself, shown only where its role or group grants it. */
function ModelChoiceRow({
  choice,
  label,
  description,
}: {
  choice: ModelChoice;
  label: string;
  description: string;
}) {
  const status = useQuery(preferencesQuery).data;
  const save = useSavePreferences();
  if (!status?.grants[choice]) return null;
  return (
    <SettingRow label={label} description={description}>
      <Switch
        aria-label={label}
        checked={status.preferences[choice]}
        onChange={(event) => save.mutate({ [choice]: event.currentTarget.checked })}
      />
    </SettingRow>
  );
}

/** LoRAs and Uncensored, where the account's role or group grants them. */
function ModelChoices() {
  const grants = useQuery(preferencesQuery).data?.grants;
  if (!grants?.loras && !grants?.uncensoredModels) return null;
  return (
    <SettingGroup title="Models">
      <ModelChoiceRow
        choice="loras"
        label="LoRAs"
        description="Offer the LoRAs you have access to. Off hides them everywhere, Dream included."
      />
      <ModelChoiceRow
        choice="uncensoredModels"
        label="Uncensored"
        description="Offer the uncensored models and themes you have access to, and let prompt ideas and suggestions use explicit wording."
      />
    </SettingGroup>
  );
}

/** The gateway text model for prompt writing, whose `cloud/` and `local/` aliases route themselves. */
function PromptAssistantModel() {
  const preferences = useQuery(preferencesQuery).data?.preferences;
  const assistant = useQuery(assistantQuery).data;
  const save = useSavePreferences();
  const models = assistant?.models || [];
  // A saved pick shows at once; one the account may no longer use shows what its writing asks for.
  const writingModel =
    preferences?.writingModel && models.includes(preferences.writingModel)
      ? preferences.writingModel
      : assistant?.writingModel;
  if (!preferences || !writingModel) return null;
  return (
    <SettingRow
      wide
      label="Prompt Assistant"
      description="The model that writes and improves prompts."
    >
      {/* The gateway's models and those of Studio's workloads serving text, keeping the current one a choice. */}
      <Select
        aria-label="Prompt Assistant"
        data={[...new Set([...models, writingModel])].map((value) => ({
          value,
          label: textModelName(value),
        }))}
        value={writingModel}
        onChange={(choice) => choice && save.mutate({ writingModel: choice })}
        allowDeselect={false}
        searchable
        nothingFoundMessage="No Matches"
      />
    </SettingRow>
  );
}

const sides: { value: SidePreference; label: string }[] = [
  { value: "cloud", label: "Cloud" },
  { value: "local", label: "Local" },
];
/** Videos' choices, as Animate's menu offers them: Cloud, or the local Fast or Quality tier. */
const videoChoices: { value: VideosPreference; label: string }[] = [
  { value: "cloud", label: "Cloud" },
  { value: "fast", label: "Fast" },
  { value: "quality", label: "Quality" },
];
/**
 * Cloud Models, then where Images, Text and Videos run by default: Cloud or Local, and for Videos
 * Cloud or the local Fast or Quality tier (unsaved, Local, Cloud and Fast). With Cloud Models off,
 * Cloud is no choice, leaving Images and Text none, and a saved Cloud reads as unsaved, as the
 * backend reads it (account-preferences.js).
 */
function WhereWorkRuns() {
  const status = useQuery(preferencesQuery).data;
  const save = useSavePreferences();
  if (!status) return null;
  const { preferences } = status;
  const cloud = preferences.cloudModels;
  const videos = !cloud && preferences.videos === "cloud" ? undefined : preferences.videos;
  const row = <T extends string>(
    label: string,
    description: string,
    data: { value: T; label: string }[],
    value: T,
    change: (choice: T) => void,
  ) => (
    <SettingRow wide label={label} description={description}>
      <SegmentedControl
        aria-label={label}
        fullWidth
        data={data}
        value={value}
        onChange={(choice) => change(choice as T)}
      />
    </SettingRow>
  );
  return (
    <SettingGroup title="Where Work Runs">
      <ModelChoiceRow
        choice="cloudModels"
        label="Cloud Models"
        description="Offer the cloud models you have access to. Off keeps all work local, here and over MCP."
      />
      {cloud &&
        row(
          "Images",
          "Where new images run until you pick a model.",
          sides,
          preferences.images || "local",
          (images) => save.mutate({ images }),
        )}
      {cloud &&
        row(
          "Text",
          "Where titles, captions, suggestions and Dream's writing run. Local shares a GPU with images.",
          sides,
          preferences.text || "cloud",
          (text) => save.mutate({ text }),
        )}
      {row(
        "Videos",
        "Where new videos run until you pick a model.",
        cloud ? videoChoices : videoChoices.filter((choice) => choice.value !== "cloud"),
        videos || "fast",
        (choice) => save.mutate({ videos: choice }),
      )}
    </SettingGroup>
  );
}

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
        <FinishLikedImages />
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
      <ModelChoices />
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
        <PromptAssistantModel />
      </SettingGroup>
      <WhereWorkRuns />
      <SettingGroup title="Danger Zone" danger>
        <DeleteFailedItems />
      </SettingGroup>
    </Stack>
  );
}

const brands: Record<string, string> = { deepseek: "DeepSeek", glm: "GLM", mimo: "MiMo" };
const titled = (word: string) => brands[word] ?? word.charAt(0).toUpperCase() + word.slice(1);
/** A gateway alias by its readable name: `cloud/glm-flash` reads GLM Flash · Cloud. */
const textModelName = (id: string) => {
  const [side, name = ""] = id.split("/");
  return `${name.split("-").map(titled).join(" ")} · ${titled(side)}`;
};
