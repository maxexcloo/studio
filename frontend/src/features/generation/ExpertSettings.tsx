import {
  ActionIcon,
  Button,
  Checkbox,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Dices, SlidersHorizontal } from "lucide-react";
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
  function number(
    key: keyof GenerationInput & string,
    label: string,
    range: ReturnType<typeof controlRange>,
    description?: string,
  ) {
    if (!range) return null;
    return (
      <NumberInput
        label={label}
        description={description}
        value={typeof input[key] === "number" ? (input[key] as number) : ""}
        onChange={(value) => onChange({ [key]: value })}
        {...range}
      />
    );
  }
  // Duration-driven workflows take seconds; frame-driven ones take frames. Never both.
  const duration = video && capabilities.duration === true;
  const frames = video && !duration && capabilities.frames !== false;
  const fps = video && !duration && capabilities.fps !== false;
  const seconds = input.fps > 0 ? `${Number((input.frames / input.fps).toFixed(1))} s` : undefined;
  const content = (
    <Stack gap="sm">
      <SimpleGrid cols={2} spacing="xs">
        {number("steps", "Steps", stepsRange(profile))}
        {number("cfg", "Guidance", controlRange(profile, "cfg", { min: 0, max: 30, step: 0.5 }))}
        {capabilities.denoise === true &&
          number(
            "denoise",
            "Denoise",
            controlRange(profile, "denoise", { min: 0, max: 1, step: 0.05 }),
          )}
        {duration &&
          number("duration", "Duration (Seconds)", controlRange(profile, "duration", { min: 1 }))}
        {frames && number("frames", "Frames", controlRange(profile, "frames", { min: 1 }), seconds)}
        {fps && number("fps", "FPS", controlRange(profile, "fps", { min: 1, max: 120 }))}
      </SimpleGrid>
      {capabilities.seed !== false && (
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
      )}
      {selections.map(({ options, field, label }) =>
        profile?.options?.[options]?.length && capabilities[field] !== false ? (
          <Select
            key={field}
            label={label}
            comboboxProps={nested}
            data={profile.options[options]}
            value={String(input[field] || "")}
            onChange={(value) => onChange({ [field]: value })}
          />
        ) : null,
      )}
      {encoderSlots.map((slot, index) => (
        <Select
          key={slot.slot}
          label={encoderSlots.length > 1 ? slot.label : "Text Encoder"}
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
      ))}
      {!encoderSlots.length && !!profile?.options?.textEncoders?.length && (
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
      )}
      {!!profile?.options?.weightDtypes?.length && capabilities.weightDtype !== false && (
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
      )}
      {inpaint && (
        <SimpleGrid cols={2} spacing="xs">
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
          <NumberInput
            label="Edge Softness"
            min={0}
            max={1}
            step={0.05}
            value={inpaint.feather ?? 0.4}
            onChange={(feather) => onChange({ inpaint: { ...inpaint, feather: Number(feather) } })}
          />
        </SimpleGrid>
      )}
      {workerIds.length > 1 && (
        <>
          <Select
            label="Worker"
            comboboxProps={nested}
            data={workerIds.map((id) => {
              const worker = workers.find((worker) => worker.id === id);
              return {
                value: id,
                label: worker
                  ? `${worker.name} · ${worker.available ? "Available" : worker.parked ? "Parked" : "Offline"}`
                  : id,
              };
            })}
            value={String(input.backendId || workerIds[0])}
            allowDeselect={false}
            onChange={(backendId) => onChange({ backendId })}
          />
          <Checkbox
            label="Allow Fallback to Another Worker"
            description="Studio waits for the selected backend unless you allow another."
            checked={Boolean(input.allowFallback)}
            onChange={(event) => onChange({ allowFallback: event.currentTarget.checked })}
          />
        </>
      )}
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
          <SlidersHorizontal size={16} />
        </Button>
      }
    >
      {content}
    </ChipPopup>
  );
}
