import { Alert, SegmentedControl, Switch, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { maxDreamIdleMinutes } from "../../../../shared/dream";
import { api } from "../../api";
import { LoadingState } from "../../ui/LoadingState";
import { NumberSetting } from "../../ui/NumberSetting";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { type Dream, type DreamSettings, dreamCountQuery, dreamQuery } from "./queries";

/** Notes a setting an administrator forces on every account (Settings › Dream Policy). */
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

/** Settings › Dream: the account's own Dream settings, each media kind in its own group. */
export function DreamPreferences() {
  const dream = useQuery(dreamQuery);
  const save = useDreamSettings();
  if (dream.isPending) return <LoadingState label="Loading Dream" fill />;
  if (dream.error) return <Alert color="red">{dream.error.message}</Alert>;
  const { settings, locked: lockedKeys } = dream.data;
  const locked = (key: keyof DreamSettings) => lockedKeys.includes(key);
  const note = (key: keyof DreamSettings) => (locked(key) ? ` ${lockedByAdministrator}` : "");
  const toggle = (
    key: "enabled" | "images" | "spicy" | "videos",
    label: string,
    description: string,
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
    key: "dailyImages" | "dailyVideos" | "imageIdleMinutes" | "videoIdleMinutes",
    label: string,
    description: string,
    disabled: boolean,
    max = maxDreamIdleMinutes,
  ) => (
    <SettingRow label={label} description={description}>
      <NumberSetting
        label={label}
        value={settings[key]}
        min={0}
        max={max}
        disabled={disabled}
        onSave={(value) => save.mutate({ [key]: value })}
      />
    </SettingRow>
  );
  const idle = (key: "imageIdleMinutes" | "videoIdleMinutes") =>
    number(
      key,
      "Idle Delay",
      "Minutes to wait after your latest generation request. Set to 0 for no extra delay.",
      !settings[key === "imageIdleMinutes" ? "images" : "videos"],
    );
  const backend = (key: "imageBackend" | "videoBackend") => (
    <SettingRow
      wide
      label="Processing"
      description={`Uses ready models allowed for your account. Waits if unavailable.${note(key)}`}
    >
      <SegmentedControl
        role="radiogroup"
        aria-label="Processing"
        fullWidth
        value={settings[key]}
        disabled={locked(key) || !settings[key === "imageBackend" ? "images" : "videos"]}
        data={[
          { value: "cloud", label: "Cloud" },
          { value: "local", label: "Local" },
        ]}
        onChange={(value) => save.mutate({ [key]: value })}
      />
    </SettingRow>
  );
  return (
    <>
      <SettingGroup title="Dream">
        {dream.data.reason && (
          <Text size="xs" c="dimmed" role="status" aria-label="Dream Status">
            {dream.data.reason}
          </Text>
        )}
        {toggle("enabled", "Enable", "Make new images from your taste in idle time.")}
        {dream.data.spicyAvailable && toggle("spicy", "Spicy", "Allow explicit themes.")}
      </SettingGroup>
      <SettingGroup title="Images">
        {toggle("images", "Enable", "Make new images.")}
        {number(
          "dailyImages",
          "Daily Amount",
          "The most images Dream makes a day.",
          !settings.images,
          500,
        )}
        {idle("imageIdleMinutes")}
        {backend("imageBackend")}
      </SettingGroup>
      <SettingGroup title="Videos">
        {toggle("videos", "Enable", "Animate kept or liked images too.")}
        {number(
          "dailyVideos",
          "Daily Amount",
          "The most videos Dream makes a day.",
          !settings.videos,
          100,
        )}
        {idle("videoIdleMinutes")}
        {backend("videoBackend")}
      </SettingGroup>
      {save.error && (
        <Alert color="red" title="Couldn't Save Dream Settings">
          {save.error.message}
        </Alert>
      )}
    </>
  );
}
