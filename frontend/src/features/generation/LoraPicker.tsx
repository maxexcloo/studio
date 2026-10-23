import { MultiSelect, NumberInput, Select, Stack, Switch, Text } from "@mantine/core";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { OrderedItems } from "../../ui/OrderedItems";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { api } from "../../api";
import { useGeneration } from "./GenerationProvider";
import type { GenerationInput } from "../../types";
interface LoraInfo {
  title?: string;
  families?: string[];
  type?: string;
  description?: string;
  role?: string;
  triggers?: string[];
  strengthRange?: { min: number; max: number; step: number; default?: number };
}
const names: Record<string, string> = {
  slider: "Sliders",
  style: "Style",
  character: "Character",
  concept: "Concept",
  unclassified: "Unclassified",
};
export function LoraPicker({
  value,
  onChange,
}: { value?: GenerationInput; onChange?: (input: GenerationInput) => void } = {}) {
  const context = useGeneration();
  const input = value || context.input;
  const profile = value
    ? context.profiles.find((profile) => profile.id === value.profileId)
    : context.profile;
  const update = (patch: Partial<GenerationInput>) =>
    onChange ? onChange({ ...input, ...patch }) : context.update(patch);
  const [type, setType] = useState<string | null>(null);
  const info = useQuery({
    queryKey: ["lora-info"],
    queryFn: () => api<{ loras: Record<string, LoraInfo> }>("/api/loras/info"),
  });
  const files = profile?.options?.loras || [];
  const family = profile?.family || "";
  const metadata = info.data?.loras || {};
  const compatible = files.filter(
    (file) => !metadata[file]?.families?.length || metadata[file].families!.includes(family),
  );
  const types = [
    ...new Set(compatible.map((file) => metadata[file]?.type || "unclassified")),
  ].sort();
  const shown = compatible.filter(
    (file) => !type || (metadata[file]?.type || "unclassified") === type,
  );
  const selected = input.loras.map((l) => l.name);
  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        LoRAs · {modelFamilyLabel(family, profile?.familyName)}
      </Text>
      <Select
        comboboxProps={{ withinPortal: true }}
        label="LoRA Type"
        disabled={info.isPending}
        placeholder="All Types"
        clearable
        data={types.map((value) => ({ value, label: names[value] || value }))}
        value={type}
        onChange={setType}
      />
      <MultiSelect
        comboboxProps={{ withinPortal: true }}
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
              <Text size="xs" c="dimmed">
                Trigger words: {metadata[lora.name].triggers!.join(", ")}
              </Text>
            )}
          </Stack>
        )}
      </OrderedItems>
    </Stack>
  );
}
