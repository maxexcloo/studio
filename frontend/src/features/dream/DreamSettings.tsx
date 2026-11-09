import { useState } from "react";
import { ActionIcon, Alert, Drawer, Popover, Stack, Switch, Text, Tooltip } from "@mantine/core";
import { icons } from "../../ui/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { NumberSetting } from "../../ui/NumberSetting";
import { SettingRow } from "../../ui/SettingRows";
import { usePhone } from "../../ui/usePhone";
import { fittedPopup } from "../generation/chip";
import { dreamQuery, dreamWhen, type Dream, type DreamSettings } from "./queries";

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
    onSuccess: (dream) => client.setQueryData(dreamQuery.queryKey, dream),
    onError: () => client.invalidateQueries({ queryKey: dreamQuery.queryKey }),
  });
}

function SettingsForm({ dream }: { dream: Dream }) {
  const save = useDreamSettings();
  const { settings } = dream;
  const toggle = (key: "enabled" | "spicy" | "videos", label: string, description: string) => (
    <SettingRow label={label} description={description}>
      <Switch
        aria-label={label}
        checked={settings[key]}
        onChange={(event) => save.mutate({ [key]: event.currentTarget.checked })}
      />
    </SettingRow>
  );
  const number = (
    key: "buffer" | "dailyImages" | "dailyVideos",
    label: string,
    max: number,
    description: string,
  ) => (
    <SettingRow label={label} description={description}>
      <NumberSetting
        label={label}
        value={settings[key]}
        min={key === "buffer" ? 1 : 0}
        max={max}
        disabled={key === "dailyVideos" && !settings.videos}
        onSave={(value) => save.mutate({ [key]: value })}
      />
    </SettingRow>
  );
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {dreamWhen(dream)}
      </Text>
      <div>
        {toggle("enabled", "Dream", "Make new images from your taste in idle time.")}
        {/* Spicy sits under the main switch; the rest run A–Z. */}
        {dream.spicyAvailable && toggle("spicy", "Spicy", "Allow explicit themes.")}
        {number("dailyImages", "Images per Day", 500, "The most images Dream makes a day.")}
        {number("buffer", "Unseen Buffer", 50, "Dream waits once this many are unseen.")}
        {toggle("videos", "Videos", "Animate kept or starred images too.")}
        {number("dailyVideos", "Videos per Day", 100, "The most videos Dream makes a day.")}
      </div>
      {save.error && (
        <Alert color="red" title="Couldn’t Save Dream Settings">
          {save.error.message}
        </Alert>
      )}
    </Stack>
  );
}

/** Dream Settings on the deck: a popover on desktop, a bottom drawer on phones. */
export function DreamSettingsButton({ dream }: { dream: Dream }) {
  const phone = usePhone();
  const [opened, setOpened] = useState(false);
  const button = (
    <Tooltip label="Dream Settings">
      <ActionIcon
        variant={opened ? "light" : "subtle"}
        color={opened ? undefined : "gray"}
        aria-label="Dream Settings"
        aria-expanded={opened}
        onClick={() => setOpened((open) => !open)}
      >
        <icons.settings size={18} />
      </ActionIcon>
    </Tooltip>
  );
  if (phone)
    return (
      <>
        {button}
        <Drawer
          opened={opened}
          onClose={() => setOpened(false)}
          position="bottom"
          radius="lg"
          styles={{ content: { height: "auto", maxHeight: "90dvh" } }}
          title="Dream Settings"
          closeButtonProps={{ "aria-label": "Close Dream Settings" }}
        >
          <SettingsForm dream={dream} />
        </Drawer>
      </>
    );
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      width={400}
      trapFocus
      {...fittedPopup}
    >
      <Popover.Target>{button}</Popover.Target>
      <Popover.Dropdown aria-label="Dream Settings" role="dialog">
        <SettingsForm dream={dream} />
      </Popover.Dropdown>
    </Popover>
  );
}
