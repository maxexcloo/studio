import { Alert, Stack, Switch, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { dreamSettingMaxima } from "../../../../shared/dream";
import { api } from "../../api";
import { LoadingState } from "../../ui/LoadingState";
import { NumberSetting } from "../../ui/NumberSetting";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { type Dream, type DreamSettings, dreamCountQuery, dreamQuery } from "./queries";

/** Notes a setting an administrator forces on every account. */
export const lockedByAdministrator = "Set by an administrator.";

/** Saves part of the Dream settings and shows the result at once. */
export function useDreamSettings() {
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError: true },
    mutationFn: (patch: Partial<DreamSettings>) =>
      api<Dream>("/api/dream/settings", { method: "PUT", body: JSON.stringify(patch) }),
    // Switches follow the hand at once; the reply (or a refetch after a failure) settles them.
    onMutate: (patch) =>
      client.setQueryData(
        dreamQuery.queryKey,
        (dream) => dream && { ...dream, settings: { ...dream.settings, ...patch } },
      ),
    onSuccess: (dream) => {
      client.setQueryData(dreamQuery.queryKey, dream);
      // The header polls its count only while Dream runs.
      void client.invalidateQueries({ queryKey: dreamCountQuery.queryKey });
    },
    onError: () => client.invalidateQueries({ queryKey: dreamQuery.queryKey }),
  });
}

/** Settings › Dream: the account's own Dream settings, in one group. */
export function DreamPreferences() {
  const dream = useQuery(dreamQuery);
  const save = useDreamSettings();
  if (dream.isPending) return <LoadingState label="Loading Dream" fill />;
  if (dream.error) return <Alert color="red">{dream.error.message}</Alert>;
  const { settings, locked: lockedKeys } = dream.data;
  const locked = (key: keyof DreamSettings) => lockedKeys.includes(key);
  const note = (key: keyof DreamSettings) => (locked(key) ? ` ${lockedByAdministrator}` : "");
  const toggle = (
    key: "enabled" | "images" | "uncensored" | "useLoadedProfile" | "videos",
    label: string,
    description = "",
  ) => (
    <SettingRow label={label} description={description + note(key)}>
      <Switch
        aria-label={label}
        checked={settings[key]}
        disabled={locked(key)}
        onChange={(event) => save.mutate({ [key]: event.currentTarget.checked })}
      />
    </SettingRow>
  );
  const number = (
    key: keyof typeof dreamSettingMaxima,
    label: string,
    description: string,
    disabled: boolean,
  ) => (
    <SettingRow label={label} description={description}>
      <NumberSetting
        key={settings[key]}
        label={label}
        value={settings[key]}
        min={0}
        max={dreamSettingMaxima[key]}
        disabled={disabled}
        onSave={(value) => save.mutate({ [key]: value })}
      />
    </SettingRow>
  );
  const mixTotal = settings.mixNew + settings.mixComparisons + settings.mixExisting;
  const mix = (key: "mixNew" | "mixComparisons" | "mixExisting", label: string, what: string) =>
    number(
      key,
      label,
      `${what} Relative to the others${mixTotal ? `: ${Math.round((settings[key] / mixTotal) * 100)}% of cards` : ""}.`,
      !settings.images,
    );
  return (
    <Stack gap="lg">
      <SettingGroup title="General">
        {dream.data.reason && (
          <Text size="xs" c="dimmed" role="status" aria-label="Dream Status">
            {dream.data.reason}
          </Text>
        )}
        {toggle("enabled", "Dream", "Make new media from your taste while Studio is idle.")}
        {toggle(
          "useLoadedProfile",
          "Run on Loaded Profile",
          "Skip the idle delay when Studio can confirm that the profile and its LoRA settings are already loaded.",
        )}
        {dream.data.uncensoredAvailable && (
          <>
            {toggle("uncensored", "Uncensored", "Allow explicit themes.")}
            {number(
              "uncensoredShare",
              "Uncensored Share",
              "Percent of ideas with explicit themes.",
              !settings.uncensored,
            )}
          </>
        )}
      </SettingGroup>
      <SettingGroup title="Images">
        {toggle("images", "Generate Images")}
        {number(
          "dailyImages",
          "Daily Images",
          "The most images Dream makes a day.",
          !settings.images,
        )}
      </SettingGroup>
      <SettingGroup title="Image Mix">
        {mix("mixNew", "New Ideas", "Fresh concepts from your taste.")}
        {mix(
          "mixComparisons",
          "Comparisons",
          "One liked prompt with a single setting changed, to learn which you prefer.",
        )}
        {mix("mixExisting", "Existing Work", "Recreations, variations and series of liked images.")}
      </SettingGroup>
      <SettingGroup title="Videos">
        {toggle("videos", "Generate Videos", "Animate kept or liked images.")}
        {number(
          "dailyVideos",
          "Daily Videos",
          "The most videos Dream makes a day.",
          !settings.videos,
        )}
      </SettingGroup>
      {save.error && (
        <Alert color="red" title="Couldn't Save Dream Settings">
          {save.error.message}
        </Alert>
      )}
    </Stack>
  );
}
