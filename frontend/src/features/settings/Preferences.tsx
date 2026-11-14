import { Button, SegmentedControl, Select, Stack, Switch } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useAccount } from "../auth/AccountGate";
import { assistantQuery } from "../generation/PromptAssistant";
import { useKeepRecentPrompts } from "../generation/PromptHistory";
import { accountAdminQuery } from "./AccountAdmin";
import {
  type GalleryWorkPreference,
  type SidePreference,
  type VideosPreference,
  preferencesQuery,
  useSavePreferences,
  useTileCaptions,
} from "./accountPreferences";
import { FinishStarredImages } from "./FinishStarredImages";

/**
 * Delete Failed Items: everyone deletes their own; administrators of a multi-user Studio may choose
 * another account's, or every account's.
 */
function DeleteFailedItems() {
  const client = useQueryClient();
  const account = useAccount().data;
  const others = account?.mode === "multi-user" && account.account?.role === "administrator";
  const accounts = useQuery({ ...accountAdminQuery, enabled: others });
  const [owner, setOwner] = useState("mine");
  const [confirming, setConfirming] = useState(false);
  const owners = [
    { value: "all", label: "All Users" },
    { value: "mine", label: "Mine" },
    ...(accounts.data?.accounts || [])
      .filter((entry) => entry.id !== account?.account?.id)
      .map((entry) => ({ value: entry.id, label: entry.username }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const whose =
    owner === "all"
      ? "every account's"
      : owner === "mine"
        ? "your"
        : `${owners.find((entry) => entry.value === owner)?.label}'s`;
  const remove = useMutation({
    mutationFn: () =>
      post<{ cleared: number }>(
        "/api/gallery/errors/clear",
        owner === "mine" ? undefined : { owner },
      ),
    onSuccess: () => {
      for (const queryKey of [["gallery"], ["gallery-filters"], ["queue"]])
        void client.invalidateQueries({ queryKey });
      setConfirming(false);
    },
  });
  return (
    <SettingRow
      label="Delete Failed Items"
      description={
        remove.data
          ? `${remove.data.cleared.toLocaleString()} deleted.`
          : "Remove failed and cancelled items from the gallery."
      }
    >
      {others && (
        <Select
          aria-label="Whose Failed Items"
          size="xs"
          w={150}
          data={owners}
          value={owner}
          allowDeselect={false}
          searchable={owners.length > 8}
          onChange={(value) => value && setOwner(value)}
        />
      )}
      <Button
        size="compact-sm"
        color="red"
        variant="light"
        leftSection={<icons.delete size={16} />}
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
      <ConfirmDialog
        opened={confirming}
        title="Delete Failed Items"
        action="Delete"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirming(false)}
      >
        Remove {whose} failed and cancelled items from the gallery?
      </ConfirmDialog>
    </SettingRow>
  );
}

/** Spicy Prompts, offered only where the account's access has Uncensored Models. */
function SpicyPrompts() {
  const status = useQuery(preferencesQuery).data;
  const save = useSavePreferences();
  if (!status?.grants.spicyPrompts) return null;
  return (
    <SettingRow
      label="Spicy Prompts"
      description="Let prompt ideas, suggestions and proposed changes use explicit wording."
    >
      <Switch
        aria-label="Spicy Prompts"
        checked={status.preferences.spicyPrompts}
        onChange={(event) => save.mutate({ spicyPrompts: event.currentTarget.checked })}
      />
    </SettingRow>
  );
}

const modelChoices = ["cloudModels", "loras", "uncensoredModels"] as const;
/** Cloud Models, LoRAs and Uncensored Models, which an account turns off for itself where its role or group grants them. */
function ModelChoices() {
  const status = useQuery(preferencesQuery).data;
  const save = useSavePreferences();
  if (!status || !modelChoices.some((key) => status.grants[key])) return null;
  const choice = (key: (typeof modelChoices)[number], label: string, description: string) =>
    status.grants[key] && (
      <SettingRow label={label} description={description}>
        <Switch
          aria-label={label}
          checked={status.preferences[key]}
          onChange={(event) => save.mutate({ [key]: event.currentTarget.checked })}
        />
      </SettingRow>
    );
  return (
    <SettingGroup title="Models">
      {choice(
        "cloudModels",
        "Cloud Models",
        "Offer the cloud models you have access to. Off hides them here and over MCP.",
      )}
      {choice(
        "loras",
        "LoRAs",
        "Offer the LoRAs you have access to. Off hides them everywhere, Dream included.",
      )}
      {choice(
        "uncensoredModels",
        "Uncensored Models",
        "Offer the uncensored models and themes you have access to. Off hides them everywhere.",
      )}
    </SettingGroup>
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
 * Where Images and Videos run by default: Cloud or Local, and for Videos Cloud or the local Fast or
 * Quality tier (unsaved, Local and Fast). Text picks the gateway text model for prompt writing,
 * whose `cloud/` and `local/` aliases route themselves.
 */
function WhereWorkRuns() {
  const status = useQuery(preferencesQuery).data;
  const assistant = useQuery(assistantQuery).data;
  const save = useSavePreferences();
  if (!status) return null;
  const { preferences } = status;
  const models = assistant?.models || [];
  // A saved pick shows at once; one the account may no longer use shows what its writing asks for.
  const writingModel =
    preferences.writingModel && models.includes(preferences.writingModel)
      ? preferences.writingModel
      : assistant?.writingModel;
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
      {row(
        "Images",
        "Where new images run until you pick a model.",
        sides,
        preferences.images || "local",
        (images) => save.mutate({ images }),
      )}
      {assistant && writingModel && (
        <SettingRow wide label="Text" description="The model that writes and improves prompts.">
          {/* The gateway's and Studio's text workloads' models, keeping the current one a choice. */}
          <Select
            aria-label="Text"
            data={[...new Set([...models, writingModel])]}
            value={writingModel}
            onChange={(choice) => choice && save.mutate({ writingModel: choice })}
            allowDeselect={false}
            searchable
            nothingFoundMessage="No Matches"
          />
        </SettingRow>
      )}
      {row(
        "Videos",
        "Where new videos run until you pick a model.",
        videoChoices,
        preferences.videos || "fast",
        (videos) => save.mutate({ videos }),
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
        <FinishStarredImages />
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
        <SpicyPrompts />
      </SettingGroup>
      <WhereWorkRuns />
      <SettingGroup title="Danger Zone" danger>
        <DeleteFailedItems />
      </SettingGroup>
    </Stack>
  );
}
