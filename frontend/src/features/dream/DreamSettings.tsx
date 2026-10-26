import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Drawer,
  NumberInput,
  Popover,
  Stack,
  Switch,
  Tooltip,
} from "@mantine/core";
import { Settings2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { usePhone } from "../../ui/usePhone";
import { dreamQuery, type Dream, type DreamSettings } from "./queries";

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

function Limit({
  label,
  description,
  value,
  min,
  max,
  disabled,
  onSave,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | number>(value);
  const commit = () => {
    const next = Number(draft);
    if (Number.isInteger(next) && next >= min && next <= max && next !== value) onSave(next);
    else setDraft(value);
  };
  return (
    <NumberInput
      label={label}
      description={description}
      value={draft}
      min={min}
      max={max}
      size="sm"
      allowDecimal={false}
      clampBehavior="strict"
      disabled={disabled}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && commit()}
    />
  );
}

function SettingsForm({ dream }: { dream: Dream }) {
  const save = useDreamSettings();
  const { settings } = dream;
  return (
    <Stack gap="md">
      <Switch
        label="Dream"
        description="Make new images in idle time from your taste profile."
        checked={settings.enabled}
        onChange={(event) => save.mutate({ enabled: event.currentTarget.checked })}
      />
      <Switch
        label="Pause"
        description="Stop making new results; the deck stays."
        checked={settings.paused}
        disabled={!settings.enabled}
        onChange={(event) => save.mutate({ paused: event.currentTarget.checked })}
      />
      <Limit
        label="Unseen Buffer"
        description="Dream waits once this many results are unseen."
        value={settings.buffer}
        min={1}
        max={50}
        onSave={(buffer) => save.mutate({ buffer })}
      />
      <Limit
        label="Images per Day"
        value={settings.dailyImages}
        min={0}
        max={500}
        onSave={(dailyImages) => save.mutate({ dailyImages })}
      />
      <Switch
        label="Videos"
        description="Animate kept or starred images too."
        checked={settings.videos}
        onChange={(event) => save.mutate({ videos: event.currentTarget.checked })}
      />
      <Limit
        label="Videos per Day"
        value={settings.dailyVideos}
        min={0}
        max={100}
        disabled={!settings.videos}
        onSave={(dailyVideos) => save.mutate({ dailyVideos })}
      />
      {dream.spicyAvailable && (
        <Switch
          label="Spicy"
          description="Allow explicit adult themes."
          checked={settings.spicy}
          onChange={(event) => save.mutate({ spicy: event.currentTarget.checked })}
        />
      )}
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
        variant="default"
        aria-label="Dream Settings"
        aria-expanded={opened}
        onClick={() => setOpened((open) => !open)}
      >
        <Settings2 size={18} />
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
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={320} trapFocus>
      <Popover.Target>{button}</Popover.Target>
      <Popover.Dropdown aria-label="Dream Settings" role="dialog">
        <SettingsForm dream={dream} />
      </Popover.Dropdown>
    </Popover>
  );
}
