import {
  ActionIcon,
  Button,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Dices } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { titleCase } from "../../../../shared/titles";
import type { GenerationInput, Profile } from "../../types";
import { icons } from "../../ui/icons";
import { iconChipProps } from "./chip";
import { controlRange, stepsRange } from "./payload";
import { ChipPopup } from "./Picker";

const selections = [
  { options: "samplers", field: "sampler", label: "Sampler" },
  { options: "schedulers", field: "scheduler", label: "Scheduler" },
  { options: "vaes", field: "vae", label: "VAE" },
] as const;
// Nested pickers stay inside the popover so choosing an option keeps it open.
const nested = { withinPortal: false } as const;

/** The Settings chip: only the settings the selected profile lets the user change. */
export function GenerationSettings({
  input,
  profile,
  onChange,
  opened,
  onOpenedChange,
}: {
  input: GenerationInput;
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
  opened: boolean;
  onOpenedChange: (opened: boolean) => void;
}) {
  const capabilities = profile?.capabilities || {};
  const video = input.kind === "video";
  const inpaint = input.inpaint as { strength?: number; feather?: number } | undefined;
  const encoderSlots = profile?.encoderSlots || [];
  const encoders = encoderSlots.map(
    (slot, index) =>
      input.textEncoders?.[index] || (index === 0 ? input.textEncoder : "") || slot.default,
  );
  // Each setting the profile offers, listed alphabetically, one per row.
  const fields: { label: string; control: ReactNode }[] = [];
  function number(
    key: keyof GenerationInput & string,
    label: string,
    range: ReturnType<typeof controlRange>,
    description?: string,
  ) {
    if (!range) return;
    fields.push({
      label,
      control: (
        <NumberInput
          label={label}
          description={description}
          value={typeof input[key] === "number" ? (input[key] as number) : ""}
          onChange={(value) => onChange({ [key]: value })}
          {...range}
        />
      ),
    });
  }
  // Duration-driven workflows take seconds; frame-driven ones take frames. Never both.
  const duration = video && capabilities.duration === true;
  const frames = video && !duration && capabilities.frames !== false;
  const fps = video && !duration && capabilities.fps !== false;
  const seconds = input.fps > 0 ? `${Number((input.frames / input.fps).toFixed(1))} s` : undefined;
  number("steps", "Steps", stepsRange(profile));
  number("cfg", "Guidance", controlRange(profile, "cfg", { min: 0, max: 30, step: 0.5 }));
  if (capabilities.denoise === true)
    number("denoise", "Denoise", controlRange(profile, "denoise", { min: 0, max: 1, step: 0.05 }));
  if (duration)
    number("duration", "Duration (Seconds)", controlRange(profile, "duration", { min: 1 }));
  if (frames) number("frames", "Frames", controlRange(profile, "frames", { min: 1 }), seconds);
  if (fps) number("fps", "FPS", controlRange(profile, "fps", { min: 1, max: 120 }));
  if (capabilities.seed !== false)
    fields.push({
      label: "Seed",
      control: (
        <TextInput
          label="Seed"
          placeholder="Random"
          value={String(input.seed)}
          onChange={(event) => onChange({ seed: event.currentTarget.value })}
          rightSection={
            input.seed !== "" && (
              <Tooltip label="Use a Random Seed">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label="Use a Random Seed"
                  onClick={() => onChange({ seed: "" })}
                >
                  <Dices size={16} />
                </ActionIcon>
              </Tooltip>
            )
          }
        />
      ),
    });
  if (video && capabilities.sound === true)
    fields.push({
      label: "Sound",
      control: (
        <Switch
          label="Sound"
          checked={input.sound !== false}
          onChange={(event) => onChange({ sound: event.currentTarget.checked })}
        />
      ),
    });
  if (!video && capabilities.transparent === true)
    fields.push({
      label: "Transparent Background",
      control: (
        <Switch
          label="Transparent Background"
          checked={input.transparent === true}
          onChange={(event) => onChange({ transparent: event.currentTarget.checked })}
        />
      ),
    });
  for (const { options, field, label } of selections)
    if (profile?.options?.[options]?.length && capabilities[field] !== false)
      fields.push({
        label,
        control: (
          <Select
            label={label}
            comboboxProps={nested}
            data={profile.options[options]}
            value={String(input[field] || "")}
            onChange={(value) => onChange({ [field]: value })}
          />
        ),
      });
  if (profile?.options?.rebalances?.length && capabilities.rebalance)
    fields.push({
      label: "Rebalance",
      control: (
        <Select
          label="Rebalance"
          description="How Krea 2 weighs the prompt's text layers; Legacy follows it hardest"
          comboboxProps={nested}
          data={profile.options.rebalances.map((value) => ({ value, label: titleCase(value) }))}
          value={String(input.rebalance || "")}
          allowDeselect={false}
          onChange={(rebalance) => {
            if (rebalance !== null) onChange({ rebalance });
          }}
        />
      ),
    });
  if (profile?.options?.qualities?.length)
    fields.push({
      label: "Quality",
      control: (
        <Select
          label="Quality"
          description="Auto is Low for new images and Medium for edits"
          comboboxProps={nested}
          data={profile.options.qualities.map((value) => ({ value, label: titleCase(value) }))}
          value={String(input.quality || profile.defaults.quality || "auto")}
          allowDeselect={false}
          onChange={(quality) => {
            if (quality !== null) onChange({ quality });
          }}
        />
      ),
    });
  encoderSlots.forEach((slot, index) => {
    const label = encoderSlots.length > 1 ? slot.label : "Text Encoder";
    fields.push({
      label,
      control: (
        <Select
          label={label}
          comboboxProps={nested}
          data={slot.options}
          value={encoders[index]}
          allowDeselect={false}
          searchable={slot.options.length > 8}
          onChange={(value) => {
            if (value === null) return;
            const textEncoders = [...encoders];
            textEncoders[index] = value;
            onChange({ textEncoders, textEncoder: textEncoders[0] });
          }}
        />
      ),
    });
  });
  if (!encoderSlots.length && !!profile?.options?.textEncoders?.length)
    fields.push({
      label: "Text Encoder",
      control: (
        <Select
          label="Text Encoder"
          comboboxProps={nested}
          data={profile.options.textEncoders}
          value={input.textEncoder || ""}
          allowDeselect={false}
          onChange={(textEncoder) => {
            if (textEncoder !== null) onChange({ textEncoder });
          }}
        />
      ),
    });
  if (!!profile?.options?.weightDtypes?.length && capabilities.weightDtype !== false)
    fields.push({
      label: "Weight Type",
      control: (
        <Select
          label="Weight Type"
          comboboxProps={nested}
          data={profile.options.weightDtypes}
          value={input.weightDtype || String(profile.defaults.weightDtype || "default")}
          allowDeselect={false}
          onChange={(weightDtype) => {
            if (weightDtype !== null) onChange({ weightDtype });
          }}
        />
      ),
    });
  if (inpaint && capabilities.inpaintStitch !== false)
    fields.push(
      {
        label: "Mask Strength",
        control: (
          <NumberInput
            label="Mask Strength"
            min={0}
            max={1}
            step={0.05}
            value={inpaint.strength ?? 1}
            onChange={(strength) =>
              onChange({ inpaint: { ...inpaint, strength: Number(strength) } })
            }
          />
        ),
      },
      {
        label: "Edge Softness",
        control: (
          <NumberInput
            label="Edge Softness"
            min={0}
            max={1}
            step={0.05}
            value={inpaint.feather ?? 0.4}
            onChange={(feather) => onChange({ inpaint: { ...inpaint, feather: Number(feather) } })}
          />
        ),
      },
    );
  fields.sort((a, b) => a.label.localeCompare(b.label));
  const content = (
    <Stack gap="sm">
      {fields.map(({ label, control }) => (
        <Fragment key={label}>{control}</Fragment>
      ))}
      {profile?.encoderBuiltIn && (
        <Text size="xs" c="dimmed">
          Text encoder built into the checkpoint.
        </Text>
      )}
    </Stack>
  );
  return (
    <ChipPopup
      title="Settings"
      tooltip
      floating
      position="top"
      width={380}
      opened={opened}
      onOpenedChange={onOpenedChange}
      target={
        <Button
          {...iconChipProps}
          aria-label="Settings"
          aria-expanded={opened}
          onClick={() => onOpenedChange(!opened)}
        >
          <icons.prompt size={16} />
        </Button>
      }
    >
      {content}
    </ChipPopup>
  );
}
