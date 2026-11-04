import { useState } from "react";
import { Button, Select, Stack, Switch } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { icons } from "../../ui/icons";
import { post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { useAccount } from "../auth/AccountGate";
import { useKeepRecentPrompts } from "../generation/PromptHistory";
import { accountAdminQuery } from "./AccountAdmin";
import { FinishStarredImages } from "./FinishStarredImages";
import { preferencesQuery, useSavePreferences, useTileCaptions } from "./accountPreferences";

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

/** Cloud Models and Uncensored Models, which an account turns off for itself where its role or group grants them. */
function ModelChoices() {
  const status = useQuery(preferencesQuery).data;
  const save = useSavePreferences();
  if (!status || (!status.grants.cloudModels && !status.grants.uncensoredModels)) return null;
  const choice = (key: "cloudModels" | "uncensoredModels", label: string, description: string) =>
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
        "Offer the cloud models you have access to. Off hides them here, in Chat and over MCP.",
      )}
      {choice(
        "uncensoredModels",
        "Uncensored Models",
        "Offer the uncensored models and themes you have access to. Off hides them everywhere.",
      )}
    </SettingGroup>
  );
}

/** Settings › Preferences: how Studio works for this account, saved with it. */
export function Preferences() {
  const keep = useKeepRecentPrompts(true);
  const [tileCaptions, setTileCaptions] = useTileCaptions();
  const loaded = useQuery(preferencesQuery).isSuccess;
  return (
    <Stack gap="lg">
      <SettingGroup title="Gallery">
        <SettingRow
          label="Tile Captions"
          description="Show each tile’s title and details on phones. Desktop shows them on hover."
        >
          <Switch
            key={loaded ? "loaded" : "loading"}
            aria-label="Tile Captions"
            checked={tileCaptions}
            disabled={!loaded}
            onChange={(event) => setTileCaptions(event.currentTarget.checked)}
          />
        </SettingRow>
        <FinishStarredImages />
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
          description="Offer your recent prompts in the composer’s history. Pinned prompts stay either way."
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
      <SettingGroup title="Danger Zone" danger>
        <DeleteFailedItems />
      </SettingGroup>
    </Stack>
  );
}
