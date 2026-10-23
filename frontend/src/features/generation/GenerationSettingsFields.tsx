import type { ReactNode } from "react";
import {
  Accordion,
  Checkbox,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  type NumberInputProps,
} from "@mantine/core";
import type { GenerationInput, Profile } from "../../types";
import { PromptHistory } from "./PromptHistory";
import { useGeneration } from "./GenerationProvider";

const selections = [
  { options: "samplers", field: "sampler", label: "Sampler" },
  { options: "schedulers", field: "scheduler", label: "Scheduler" },
  { options: "vaes", field: "vae", label: "VAE" },
  { options: "resolutions", field: "resolution", label: "Resolution" },
] as const;

export function GenerationSettingsFields({
  input,
  profile,
  onChange,
  presets,
}: {
  input: GenerationInput;
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
  presets?: ReactNode;
}) {
  const { models } = useGeneration();
  const workers = models.data?.workers || [];
  const worker = workers.find((worker) => worker.id === input.backendId);
  const inpaint = input.inpaint as { strength?: number; feather?: number } | undefined;
  const encoderSlots = profile?.encoderSlots || [];
  const encoders = encoderSlots.map(
    (slot, index) =>
      input.textEncoders?.[index] || (index === 0 ? input.textEncoder : "") || slot.default,
  );
  function number(key: keyof GenerationInput, label: string, fallback: NumberInputProps = {}) {
    const constraints = profile?.constraints?.[String(key)];
    return (
      <NumberInput
        label={label}
        value={typeof input[key] === "number" ? (input[key] as number) : ""}
        onChange={(value) => onChange({ [key]: value })}
        {...fallback}
        min={constraints?.min ?? fallback.min}
        max={constraints?.max ?? fallback.max}
        step={constraints?.step ?? fallback.step}
      />
    );
  }
  return (
    <Stack gap="md">
      {profile?.capabilities.negativePrompt !== false && (
        <Textarea
          label="Negative Prompt"
          rightSection={
            <PromptHistory
              kind="negative"
              value={input.negative}
              onPick={(negative) => onChange({ negative })}
            />
          }
          rightSectionPointerEvents="all"
          rightSectionProps={{ style: { alignItems: "flex-start", paddingTop: 8 } }}
          autosize
          minRows={1}
          value={input.negative}
          onChange={(event) => onChange({ negative: event.currentTarget.value })}
        />
      )}
      {inpaint && (
        <SimpleGrid cols={2}>
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
      <Accordion variant="separated" transitionDuration={0}>
        <Accordion.Item value="expert">
          <Accordion.Control>Expert Controls</Accordion.Control>
          <Accordion.Panel>
            <Stack>
              {!!profile?.workerIds?.length && (
                <Select
                  label="Worker"
                  comboboxProps={{ withinPortal: true }}
                  data={profile.workerIds.map((id) => {
                    const worker = workers.find((worker) => worker.id === id);
                    return {
                      value: id,
                      label: worker
                        ? `${worker.name} · ${worker.available ? "Available" : "Offline"}`
                        : id,
                    };
                  })}
                  value={String(input.backendId || profile.workerIds[0])}
                  allowDeselect={false}
                  onChange={(backendId) => onChange({ backendId })}
                />
              )}
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
              {profile?.description && (
                <Text size="xs" c="dimmed">
                  {profile.description}
                </Text>
              )}

              <SimpleGrid cols={2}>
                {number("steps", "Steps", { min: 1, max: 200 })}
                {profile?.capabilities.cfg !== false &&
                  number("cfg", "Guidance", { min: 0, max: 30, step: 0.5 })}
                {number("count", "Count", { min: 1, max: 8 })}
                {number("denoise", "Denoise", { min: 0, max: 1, step: 0.05 })}
              </SimpleGrid>
              <TextInput
                label="Seed"
                description="Leave blank for a random seed."
                value={String(input.seed)}
                onChange={(event) => onChange({ seed: event.currentTarget.value })}
              />
              {input.kind === "video" && (
                <SimpleGrid cols={2}>
                  {number("fps", "FPS", { min: 1, max: 120 })}
                  {number("frames", "Frames", { min: 1 })}
                  {number("duration", "Duration (Seconds)", { min: 1 })}
                </SimpleGrid>
              )}
              {selections.map(({ options, field, label }) =>
                profile?.options?.[options]?.length ? (
                  <Select
                    key={field}
                    label={label}
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
                  data={profile.options.textEncoders}
                  value={input.textEncoder || ""}
                  allowDeselect={false}
                  onChange={(textEncoder) => {
                    if (textEncoder !== null) onChange({ textEncoder });
                  }}
                />
              )}
              {profile?.encoderBuiltIn && (
                <Text size="xs" c="dimmed">
                  Text encoder built into the checkpoint.
                </Text>
              )}
              {!!profile?.options?.weightDtypes?.length &&
                profile.capabilities.weightDtype !== false && (
                  <Select
                    label="Weight Type"
                    data={profile.options.weightDtypes}
                    value={input.weightDtype || String(profile.defaults.weightDtype || "default")}
                    allowDeselect={false}
                    onChange={(weightDtype) => {
                      if (weightDtype !== null) onChange({ weightDtype });
                    }}
                  />
                )}
              {profile?.provider !== "cliproxyapi" && (
                <Checkbox
                  label="Allow Fallback to Another Worker"
                  description="Studio waits for the selected backend unless you allow another."
                  checked={Boolean(input.allowFallback)}
                  onChange={(event) => onChange({ allowFallback: event.currentTarget.checked })}
                />
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
        {presets && (
          <Accordion.Item value="presets">
            <Accordion.Control>Saved Presets</Accordion.Control>
            <Accordion.Panel>{presets}</Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>
    </Stack>
  );
}
