import { Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { useGeneration } from "./GenerationProvider";
import type { Profile } from "../../types";
const family = (profile: Profile) => profile.familyName || profile.family;
const model = (profile: Profile) =>
  profile.recipe?.modelLabel || profile.baseModel || profile.model;
const preset = (profile: Profile) =>
  profile.recipe?.label || profile.variantLabel || profile.displayName || profile.label;
const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
export function ModelPicker() {
  const { models: catalogue, profiles, profile, input, update, selectProfile } = useGeneration();
  const available = profiles.filter((p) => p.kind === input.kind);
  const families = unique(available.map(family));
  const inFamily = available.filter((p) => family(p) === (profile ? family(profile) : families[0]));
  const models = unique(inFamily.map(model));
  const inModel = inFamily.filter((p) => model(p) === (profile ? model(profile) : models[0]));
  const workers = catalogue.data?.workers || [];
  const worker = workers.find((value) => value.id === input.backendId);
  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Select
          comboboxProps={{ withinPortal: false }}
          label="Family"
          placeholder="Choose a family"
          searchable
          data={families}
          value={profile ? family(profile) : null}
          allowDeselect={false}
          onChange={(value) => {
            const next = available.find((p) => family(p) === value);
            if (next) selectProfile(next);
          }}
        />
        <Select
          comboboxProps={{ withinPortal: false }}
          label="Model & Finetune"
          searchable
          data={models}
          value={profile ? model(profile) : null}
          allowDeselect={false}
          onChange={(value) => {
            const next = inFamily.find((p) => model(p) === value);
            if (next) selectProfile(next);
          }}
        />
        <Select
          comboboxProps={{ withinPortal: false }}
          label="Fast, Quality & Workflow Preset"
          data={inModel.map((p) => ({ value: p.id, label: preset(p) }))}
          value={profile?.id || null}
          allowDeselect={false}
          onChange={(value) => {
            const next = inModel.find((p) => p.id === value);
            if (next) selectProfile(next);
          }}
        />
      </SimpleGrid>
      {!!profile?.workerIds?.length && (
        <Select
          label="Worker"
          comboboxProps={{ withinPortal: false }}
          data={profile.workerIds.map((id) => {
            const worker = workers.find((value) => value.id === id);
            return {
              value: id,
              label: worker ? `${worker.name} · ${worker.available ? "Available" : "Offline"}` : id,
            };
          })}
          value={String(input.backendId || profile.workerIds[0])}
          allowDeselect={false}
          onChange={(backendId) => update({ backendId })}
        />
      )}
      {worker?.gpuDevices?.length && (
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
        <Text c="dimmed" size="xs">
          {profile.description}
        </Text>
      )}
    </Stack>
  );
}
