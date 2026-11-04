import type { ReactNode } from "react";
import {
  ActionIcon,
  Box,
  Button,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Dices } from "lucide-react";
import { icons } from "../../ui/icons";
import type { GenerationInput, Profile } from "../../types";
import { iconChipProps } from "./chip";
import { useGeneration } from "./GenerationProvider";
import { controlRange, stepsRange } from "./payload";
import { ChipPopup } from "./Picker";

const selections = [
  { options: "samplers", field: "sampler", label: "Sampler" },
  { options: "schedulers", field: "scheduler", label: "Scheduler" },
  { options: "vaes", field: "vae", label: "VAE" },
  { options: "resolutions", field: "resolution", label: "Resolution" },
] as const;
// Nested pickers stay inside the popover so choosing an option keeps it open.
const nested = { withinPortal: false } as const;

/** The Expert chip: only the settings the selected profile lets the user change. */
export function ExpertSettings({
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
  const { models } = useGeneration();
  const workers = models.data?.workers || [];
  const workerIds = profile?.workerIds || [];
  const worker = workers.find((worker) => worker.id === (input.backendId || workerIds[0]));
  const capabilities = profile?.capabilities || {};
  const video = input.kind === "video";
  const inpaint = input.inpaint as { strength?: number; feather?: number } | undefined;
  const encoderSlots = profile?.encoderSlots || [];
  const encoders = encoderSlots.map(
    (slot, index) =>
      input.textEncoders?.[index] || (index === 0 ? input.textEncoder : "") || slot.default,
  );
  // Each setting the profile offers, listed alphabetically; wide ones take the full row.
  const fields: { label: string; wide?: boolean; control: ReactNode }[] = [];
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
      wide: true,
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
  for (const { options, field, label } of selections)
    if (profile?.options?.[options]?.length && capabilities[field] !== false)
      fields.push({
        label,
        wide: true,
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
  encoderSlots.forEach((slot, index) => {
    const label = encoderSlots.length > 1 ? slot.label : "Text Encoder";
    fields.push({
      label,
      wide: true,
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
      wide: true,
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
      wide: true,
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
  if (inpaint)
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
  // Fallback belongs with the worker it falls back from, so it sorts with Worker.
  if (workerIds.length > 1)
    fields.push({
      label: "Worker",
      wide: true,
      control: (
        <Stack gap="sm">
          <Select
            label="Worker"
            comboboxProps={nested}
            data={workerIds.map((id) => {
              const worker = workers.find((worker) => worker.id === id);
              return {
                value: id,
                label: worker
                  ? `${worker.name} · ${worker.available ? "Available" : worker.parked ? "Stopped" : "Offline"}`
                  : id,
              };
            })}
            value={String(input.backendId || workerIds[0])}
            allowDeselect={false}
            onChange={(backendId) => onChange({ backendId })}
          />
          <Switch
            label="Allow Fallback to Another Worker"
            description="Studio waits for the selected backend unless you allow another."
            checked={Boolean(input.allowFallback)}
            onChange={(event) => onChange({ allowFallback: event.currentTarget.checked })}
          />
        </Stack>
      ),
    });
  fields.sort((a, b) => a.label.localeCompare(b.label));
  const content = (
    <Stack gap="sm">
      <SimpleGrid cols={2} spacing="xs" verticalSpacing="sm">
        {fields.map(({ label, wide, control }) => (
          <Box key={label} style={wide ? { gridColumn: "1 / -1" } : undefined}>
            {control}
          </Box>
        ))}
      </SimpleGrid>
      {(worker?.gpuDevices?.length || profile?.provider) && (
        <Stack gap={2}>
          {!!worker?.gpuDevices?.length && (
            <Text size="xs" c="dimmed">
              GPU placement: {worker.gpuDevices.join(", ")}
            </Text>
          )}
          {profile?.provider && (
            <Text size="xs" c="dimmed">
              Provider: {profile.provider === "cliproxyapi" ? "CLIProxyAPI" : profile.provider}
            </Text>
          )}
          {profile?.encoderBuiltIn && (
            <Text size="xs" c="dimmed">
              Text encoder built into the checkpoint.
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
  return (
    <ChipPopup
      title="Expert Settings"
      tooltip
      position="top"
      width={380}
      opened={opened}
      onOpenedChange={onOpenedChange}
      target={
        <Button
          {...iconChipProps}
          aria-label="Expert Settings"
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
