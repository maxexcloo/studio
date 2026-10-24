import {
  Anchor,
  Box,
  Popover,
  ScrollArea,
  Button,
  Group,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Layers } from "lucide-react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { LoraStacks } from "./LoraStacks";
import { OrderedItems } from "../../ui/OrderedItems";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { copyText } from "../../ui/clipboard";
import { api } from "../../api";
import { useGeneration } from "./GenerationProvider";
import type { GenerationInput } from "../../types";
import { usePhone } from "../../ui/usePhone";
import { chipProps } from "./chip";
import classes from "./GenerationInputControls.module.css";
import editorClasses from "./GenerationEditor.module.css";
interface LoraInfo {
  title?: string;
  sourceUrl?: string;
  families?: string[];
  type?: string;
  description?: string;
  role?: string;
  triggers?: string[];
  strengthRange?: { min: number; max: number; step: number; default?: number };
}
export const loraInfoQuery = queryOptions({
  queryKey: ["lora-info"],
  queryFn: () => api<{ loras: Record<string, LoraInfo> }>("/api/loras/info"),
});
const names: Record<string, string> = {
  slider: "Sliders",
  style: "Style",
  character: "Character",
  concept: "Concept",
  unclassified: "Unclassified",
};
export function useLoraPicker() {
  const [opened, setOpened] = useState(false);
  const [type, setType] = useState<string | null>(null);
  const controlsId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const wasOpened = useRef(false);
  useLayoutEffect(() => {
    if (
      wasOpened.current &&
      !opened &&
      (document.activeElement === document.body ||
        controls.current?.contains(document.activeElement))
    ) {
      trigger.current?.focus({ preventScroll: true });
    }
    wasOpened.current = opened;
  }, [opened]);
  return { opened, setOpened, type, setType, controlsId, trigger, controls };
}
export type LoraPickerState = ReturnType<typeof useLoraPicker>;
interface LoraPickerProps {
  value?: GenerationInput;
  onChange?: (input: GenerationInput) => void;
  picker: LoraPickerState;
  inline?: boolean;
}
export function LoraPicker({ value, onChange, picker, inline = false }: LoraPickerProps) {
  const context = useGeneration();
  const input = value || context.input;
  const phone = usePhone();
  const info = useQuery(loraInfoQuery);
  const close = () => picker.setOpened(false);
  const controls = (
    <LoraControls
      value={value}
      onChange={onChange}
      type={picker.type}
      onTypeChange={picker.setType}
    />
  );
  const content = (
    <Stack
      role="region"
      id={picker.controlsId}
      ref={picker.controls}
      aria-label="LoRA Controls"
      data-composer-layer
      gap="sm"
      flex={inline ? 1 : undefined}
      mih={0}
    >
      <Group justify="space-between">
        <Button
          autoFocus={inline}
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={<ArrowLeft size={16} />}
          onClick={close}
        >
          Back
        </Button>
        <Text size="sm" fw={500}>
          LoRAs
        </Text>
      </Group>
      {inline ? (
        controls
      ) : (
        <ScrollArea.Autosize mah="min(65dvh, 600px)" offsetScrollbars="present">
          {controls}
        </ScrollArea.Autosize>
      )}
      <Box className={editorClasses.footer} data-sticky={inline || undefined}>
        <Button fullWidth onClick={close}>
          Use LoRAs
        </Button>
      </Box>
    </Stack>
  );
  const enabled = input.loras.filter((lora) => lora.enabled !== false);
  const first = enabled[0] || input.loras[0];
  const summary = first
    ? `${info.data?.loras[first.name]?.title || first.name.replace(/\.[^.]+$/, "")}${input.loras.length > 1 ? ` +${input.loras.length - 1}` : ""}`
    : "LoRAs";
  const trigger = (
    <Button
      ref={picker.trigger}
      {...chipProps}
      aria-label="Choose LoRAs"
      aria-expanded={picker.opened}
      aria-controls={picker.controlsId}
      leftSection={<Layers size={15} />}
      onClick={() => picker.setOpened(!picker.opened)}
    >
      <span className={classes.label}>{summary}</span>
    </Button>
  );
  if (inline) return content;
  // Phones show the controls inline in place of the form (see GenerationEditor).
  if (phone) return trigger;
  return (
    <Popover
      opened={picker.opened}
      onChange={picker.setOpened}
      position="top-end"
      width={420}
      trapFocus
      shadow="md"
      keepMounted
      returnFocus
      closeOnEscape={false}
    >
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown
        data-composer-layer
        onKeyDown={(event) => {
          // Escape in an open nested combobox closes only that dropdown.
          if (
            event.key === "Escape" &&
            !(event.target as HTMLElement).closest('[role="combobox"][aria-expanded="true"]')
          ) {
            event.stopPropagation();
            close();
          }
        }}
      >
        {content}
      </Popover.Dropdown>
    </Popover>
  );
}
function LoraControls({
  value,
  onChange,
  type,
  onTypeChange,
}: {
  value?: GenerationInput;
  onChange?: (input: GenerationInput) => void;
  type: string | null;
  onTypeChange: (type: string | null) => void;
}) {
  const context = useGeneration();
  const input = value || context.input;
  const profile = value
    ? context.profiles.find((profile) => profile.id === value.profileId)
    : context.profile;
  const update = (patch: Partial<GenerationInput>) =>
    onChange ? onChange({ ...input, ...patch }) : context.update(patch);
  const info = useQuery(loraInfoQuery);
  const files = profile?.options?.loras || [];
  const family = profile?.family || "";
  const metadata = info.data?.loras || {};
  const compatible = files.filter(
    (file) => !metadata[file]?.families?.length || metadata[file].families!.includes(family),
  );
  const types = [
    ...new Set(compatible.map((file) => metadata[file]?.type || "unclassified")),
  ].sort();
  const activeType = type && types.includes(type) ? type : null;
  const shown = compatible.filter(
    (file) => !activeType || (metadata[file]?.type || "unclassified") === activeType,
  );
  const selected = input.loras.map((l) => l.name);
  return (
    <Stack gap="xs">
      <LoraStacks
        key={family}
        family={family}
        profileId={profile?.id || ""}
        loras={input.loras}
        onLoad={(loras) => update({ loras })}
      />
      <Text size="sm" fw={500}>
        LoRAs · {modelFamilyLabel(family, profile?.familyName)}
      </Text>
      <Select
        comboboxProps={{ withinPortal: false }}
        label="LoRA Type"
        disabled={info.isPending}
        placeholder="All Types"
        clearable
        data={types.map((value) => ({ value, label: names[value] || value }))}
        value={activeType}
        onChange={onTypeChange}
      />
      <MultiSelect
        comboboxProps={{ withinPortal: false }}
        label="LoRAs"
        disabled={info.isPending}
        searchable
        data={[...new Set([...shown, ...selected])].map((file) => ({
          value: file,
          label: metadata[file]?.title || file,
        }))}
        value={selected}
        onChange={(values) =>
          update({
            loras: values.map(
              (name) =>
                input.loras.find((l) => l.name === name) || {
                  name,
                  strength: metadata[name]?.strengthRange?.default ?? 1,
                  enabled: true,
                },
            ),
          })
        }
      />
      {!!input.loras.length && (
        <Text size="xs" fw={600}>
          Selected LoRAs
        </Text>
      )}
      {profile?.maxLoras &&
        input.loras.filter((lora) => lora.enabled !== false).length > profile.maxLoras && (
          <Text size="xs" c="yellow">
            This profile supports up to {profile.maxLoras} enabled LoRAs. Disable or remove extras
            before generating.
          </Text>
        )}
      <OrderedItems
        kind="loras"
        items={input.loras}
        identity={(lora) => lora.name}
        label={(lora) => metadata[lora.name]?.title || lora.name}
        onChange={(loras) => update({ loras })}
      >
        {(lora) => (
          <Stack key={lora.name} gap={4}>
            <Switch
              label={`Enable ${metadata[lora.name]?.title || lora.name}`}
              checked={lora.enabled !== false}
              onChange={(event) =>
                update({
                  loras: input.loras.map((item) =>
                    item.name === lora.name
                      ? { ...item, enabled: event.currentTarget.checked }
                      : item,
                  ),
                })
              }
            />
            <NumberInput
              label={metadata[lora.name]?.title || lora.name}
              value={lora.strength}
              clampBehavior="none"
              step={metadata[lora.name]?.strengthRange?.step ?? 0.05}
              onChange={(strength) =>
                update({
                  loras: input.loras.map((l) =>
                    l.name === lora.name ? { ...l, strength: Number(strength) } : l,
                  ),
                })
              }
            />
            {metadata[lora.name]?.strengthRange && (
              <Text size="xs" c="dimmed">
                Suggested strength: {metadata[lora.name].strengthRange!.min}–
                {metadata[lora.name].strengthRange!.max}
              </Text>
            )}
            {!compatible.includes(lora.name) && (
              <Text size="xs" c="yellow">
                This LoRA is unavailable for the selected profile. Disable or remove it before
                generating.
              </Text>
            )}
            {metadata[lora.name]?.description && (
              <Text size="xs" c="dimmed">
                {metadata[lora.name].description}
              </Text>
            )}
            {metadata[lora.name]?.triggers?.length && (
              <Group gap={4}>
                <Text size="xs" c="dimmed">
                  Trigger words:
                </Text>
                {metadata[lora.name].triggers!.map((word) => (
                  <Button
                    key={word}
                    size="compact-xs"
                    variant="subtle"
                    aria-label={`Copy Trigger Word: ${word}`}
                    onClick={() => void copyText(word, "Trigger Word")}
                  >
                    {word}
                  </Button>
                ))}
              </Group>
            )}
            {metadata[lora.name]?.sourceUrl && (
              <Anchor
                size="xs"
                href={metadata[lora.name].sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View Source
              </Anchor>
            )}
          </Stack>
        )}
      </OrderedItems>
    </Stack>
  );
}
