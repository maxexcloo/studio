import { MultiSelect, NumberInput, Select, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { useGeneration } from "./GenerationProvider";
interface LoraInfo {
  title?: string;
  families?: string[];
  type?: string;
  description?: string;
  role?: string;
  triggers?: string[];
}
const names: Record<string, string> = {
  slider: "Sliders",
  style: "Style",
  character: "Character",
  concept: "Concept",
  unclassified: "Unclassified",
};
export function LoraPicker() {
  const { input, profile, update } = useGeneration();
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
        LoRAs · {profile?.familyName || family}
      </Text>
      <Select
        comboboxProps={{ withinPortal: false }}
        label="LoRA Type"
        placeholder="All Types"
        clearable
        data={types.map((value) => ({ value, label: names[value] || value }))}
        value={type}
        onChange={setType}
      />
      <MultiSelect
        comboboxProps={{ withinPortal: false }}
        label="LoRAs"
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
                input.loras.find((l) => l.name === name) || { name, strength: 1, enabled: true },
            ),
          })
        }
      />
      {input.loras.map((lora) => (
        <Stack key={lora.name} gap={4}>
          <NumberInput
            label={metadata[lora.name]?.title || lora.name}
            value={lora.strength}
            min={-2}
            max={2}
            step={0.1}
            onChange={(strength) =>
              update({
                loras: input.loras.map((l) =>
                  l.name === lora.name ? { ...l, strength: Number(strength) } : l,
                ),
              })
            }
          />
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
      ))}
    </Stack>
  );
}
