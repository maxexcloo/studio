import { Alert, Button, Modal, NumberInput, Stack, Switch, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  type DreamLimit,
  type DreamMixKey,
  dreamMixBudget,
  dreamMixKeys,
  dreamMixTotal,
} from "../../../../shared/dream";
import { api } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { LoadingState } from "../../ui/LoadingState";
import { NumberSetting } from "../../ui/NumberSetting";
import { closeWhenTop } from "../../ui/popupClicks";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { usePhone } from "../../ui/usePhone";
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

const mixLabels = {
  mixComparisons: "Comparisons",
  mixExisting: "Existing Work",
  mixNew: "New Ideas",
} satisfies Record<DreamMixKey, string>;

function DreamMix({ settings }: { settings: DreamSettings }) {
  const save = useDreamSettings();
  const phone = usePhone();
  const [draft, setDraft] = useState<Pick<DreamSettings, DreamMixKey>>();
  const close = () => setDraft(undefined);
  const total = dreamMixTotal(draft ?? settings);
  const summary = total
    ? dreamMixKeys
        .map(
          (key) =>
            `${mixLabels[key]} ${Math.round(((draft ?? settings)[key] / total) * 1000) / 10}%`,
        )
        .join(" · ")
    : "No kind prioritised.";
  return (
    <>
      <SettingRow label="Image Mix" description={summary}>
        <Button
          size="compact-sm"
          variant="default"
          aria-label="Edit Image Mix"
          disabled={!settings.images}
          onClick={() => {
            save.reset();
            const { mixComparisons, mixExisting, mixNew } = settings;
            setDraft({ mixComparisons, mixExisting, mixNew });
          }}
        >
          Edit
        </Button>
      </SettingRow>
      <Modal
        id="dream-mix"
        title="Image Mix"
        opened={!!draft}
        fullScreen={phone}
        onClose={closeWhenTop("dream-mix", close)}
      >
        {draft && (
          <Stack>
            <Text size="sm" c="dimmed">
              The shares are relative. Dream can fall back to another kind when work is unavailable.
            </Text>
            {dreamMixKeys.map((key) => (
              <NumberInput
                key={key}
                label={mixLabels[key]}
                value={draft[key]}
                min={0}
                max={dreamMixBudget - total + draft[key]}
                clampBehavior="strict"
                allowDecimal={false}
                onChange={(value) =>
                  setDraft({ ...draft, [key]: value === "" ? 0 : Number(value) })
                }
              />
            ))}
            <Text size="sm" c="dimmed">
              {summary}
            </Text>
            {save.error && <Alert color="red">{save.error.message}</Alert>}
            <DialogFooter onCancel={close}>
              <Button
                disabled={save.isPending || total > dreamMixBudget}
                onClick={() => save.mutate(draft, { onSuccess: close })}
              >
                Save
              </Button>
            </DialogFooter>
          </Stack>
        )}
      </Modal>
    </>
  );
}

/** Settings › Dream: the account's own Dream settings, in one group. */
export function DreamPreferences() {
  const dream = useQuery(dreamQuery);
  const save = useDreamSettings();
  if (dream.isPending) return <LoadingState label="Loading Dream" fill />;
  if (dream.error) return <Alert color="red">{dream.error.message}</Alert>;
  const { settings, limits, locked: lockedKeys } = dream.data;
  const locked = (key: keyof DreamSettings) => lockedKeys.includes(key);
  const note = (key: keyof DreamSettings) => (locked(key) ? ` ${lockedByAdministrator}` : "");
  const toggle = (
    key: "enabled" | "images" | "uncensored" | "useLoadedProfile" | "videos",
    label: string,
    description = "",
    name = label,
  ) => (
    <SettingRow label={label} description={description + note(key)}>
      <Switch
        aria-label={name}
        checked={settings[key]}
        disabled={locked(key)}
        onChange={(event) => save.mutate({ [key]: event.currentTarget.checked })}
      />
    </SettingRow>
  );
  const number = (
    key: DreamLimit,
    label: string,
    description: string,
    disabled: boolean,
    max: number,
  ) => (
    <SettingRow label={label} description={description}>
      <NumberSetting
        key={settings[key]}
        label={label}
        value={settings[key]}
        min={key === "pauseAfterUnseen" && !limits.unseenOff ? 1 : 0}
        max={max}
        disabled={disabled}
        onSave={(value) => save.mutate({ [key]: value })}
      />
    </SettingRow>
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
        {number(
          "pauseAfterUnseen",
          "Pause After Unseen",
          `Dream waits while this many cards are unseen, up to ${limits.pauseAfterUnseen}.${limits.unseenOff ? " 0 never waits." : ""}`,
          !settings.enabled,
          limits.pauseAfterUnseen,
        )}
        {toggle(
          "useLoadedProfile",
          "Run on Loaded Model",
          "Skip the idle delay when the model is already loaded.",
        )}
        {dream.data.uncensoredAvailable &&
          toggle("uncensored", "Uncensored", "Allow explicit themes.")}
      </SettingGroup>
      <SettingGroup title="Mix">
        <DreamMix settings={settings} />
      </SettingGroup>
      <SettingGroup title="Images">
        {toggle("images", "Enabled", "", "Enable Dream Images")}
        {number(
          "dailyImages",
          "Daily Images",
          `The most images Dream makes a day, up to ${limits.dailyImages}.`,
          !settings.images,
          limits.dailyImages,
        )}
      </SettingGroup>
      <SettingGroup title="Videos">
        {toggle("videos", "Enabled", "Animate kept or liked images.", "Enable Dream Videos")}
        {number(
          "dailyVideos",
          "Daily Videos",
          `The most videos Dream makes a day, up to ${limits.dailyVideos}.`,
          !settings.videos,
          limits.dailyVideos,
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
