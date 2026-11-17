import { Button, SegmentedControl, Select, Stack, Switch } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";

import { isCloudProfile } from "../../../../shared/profiles";
import { icons } from "../../ui/icons";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { titleCase } from "../../ui/titleCase";
import { modelsQuery } from "../generation/GenerationProvider";
import { profileName } from "../generation/payload";
import { assistantQuery } from "../generation/PromptAssistant";
import { useKeepRecentPrompts } from "../generation/PromptHistory";
import {
  type GalleryWorkPreference,
  type SidePreference,
  type WorkKind,
  defaultModelKeys,
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
        description="Offer uncensored models and themes, and allow explicit prompt ideas."
      />
    </SettingGroup>
  );
}

const sides: { value: SidePreference; label: string }[] = [
  { value: "cloud", label: "Cloud" },
  { value: "local", label: "Local" },
];
const kinds: { kind: WorkKind; label: string; description: string }[] = [
  { kind: "images", label: "Images", description: "Where new images run until you pick a model." },
  {
    kind: "text",
    label: "Text",
    description:
      "Where prompt writing, titles, captions, suggestions and Dream's writing run. Local shares a GPU with images.",
  },
  {
    kind: "videos",
    label: "Videos",
    description: "Where new videos and Animate run until you pick a model.",
  },
];

/**
 * Cloud Models, then for Images, Text and Videos where each runs by default (unsaved, Local, Cloud
 * and Local) and its default model on each side, the deployment's until one is chosen. With Cloud
 * Models off, Cloud is no choice and only the Local defaults remain, as the backend reads it
 * (account-preferences.js).
 */
function WhereWorkRuns() {
  const status = useQuery(preferencesQuery).data;
  const profiles = useQuery(modelsQuery).data?.profiles;
  const textModels = useQuery(assistantQuery).data?.models;
  const save = useSavePreferences();
  if (!status) return null;
  const { preferences } = status;
  const cloud = preferences.cloudModels;
  const choices = (kind: WorkKind, side: SidePreference) =>
    kind === "text"
      ? (textModels || [])
          .filter((model) => model.startsWith("local/") === (side === "local"))
          .map((value) => ({ value, label: textModelName(value) }))
      : (profiles || [])
          .filter(
            (profile) =>
              profile.kind === (kind === "images" ? "image" : "video") &&
              isCloudProfile(profile) === (side === "cloud"),
          )
          .map((profile) => ({ value: profile.id, label: profileName(profile) }));
  const defaultRow = (kind: WorkKind, label: string, side: SidePreference) => {
    const key = defaultModelKeys[kind][side];
    const name = `${label} ${side === "cloud" ? "Cloud" : "Local"} Default`;
    const data = choices(kind, side);
    const value = preferences[key];
    return (
      <SettingRow
        key={key}
        wide
        label={`${side === "cloud" ? "Cloud" : "Local"} Default`}
        description={`The ${label.toLowerCase()} model ${side === "cloud" ? "Cloud" : "Local"} uses until you pick one.`}
      >
        <Select
          aria-label={name}
          placeholder="Studio's Default"
          // A saved model no longer offered stays a choice, so it reads as what it is.
          data={value && !data.some((item) => item.value === value) ? [...data, value] : data}
          value={value ?? null}
          onChange={(choice) => save.mutate({ [key]: choice })}
          clearable
          searchable
          nothingFoundMessage="No Matches"
        />
      </SettingRow>
    );
  };
  return (
    <SettingGroup title="Where Work Runs">
      <ModelChoiceRow
        choice="cloudModels"
        label="Cloud Models"
        description="Offer the cloud models you have access to. Off keeps all work local, here and over MCP."
      />
      {kinds.map(({ kind, label, description }) => (
        <Fragment key={kind}>
          {cloud && (
            <SettingRow wide label={label} description={description}>
              <SegmentedControl
                aria-label={label}
                fullWidth
                data={sides}
                value={preferences[kind] || (kind === "text" ? "cloud" : "local")}
                onChange={(side) => save.mutate({ [kind]: side as SidePreference })}
              />
            </SettingRow>
          )}
          {cloud && defaultRow(kind, label, "cloud")}
          {defaultRow(kind, label, "local")}
        </Fragment>
      ))}
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
      </SettingGroup>
      <WhereWorkRuns />
      <SettingGroup title="Danger Zone" danger>
        <DeleteFailedItems />
      </SettingGroup>
    </Stack>
  );
}

const brands: Record<string, string> = { deepseek: "DeepSeek", glm: "GLM", mimo: "MiMo" };
const titled = (word: string) => brands[word] ?? titleCase(word);
/** A gateway alias by its readable name: `cloud/glm-flash` reads GLM Flash · Cloud. */
const textModelName = (id: string) => {
  const [side, name = ""] = id.split("/");
  return `${name.split("-").map(titled).join(" ")} · ${titled(side)}`;
};
