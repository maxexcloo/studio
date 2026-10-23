import { Accordion, Group, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { inputForProfile, useGeneration } from "./GenerationProvider";
import type { GenerationInput, Profile } from "../../types";
const family = (profile: Profile) => profile.familyName || profile.family;
const model = (profile: Profile) =>
  profile.recipe?.modelLabel || profile.baseModel || profile.model;
const preset = (profile: Profile) =>
  profile.recipe?.label || profile.variantLabel || profile.displayName || profile.label;
const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
export function ProfilePicker({
  value,
  onChange,
}: { value?: GenerationInput; onChange?: (value: GenerationInput) => void } = {}) {
  const context = useGeneration();
  const { models: catalogue, profiles } = context;
  const input = value || context.input;
  const profile = value
    ? profiles.find((profile) => profile.id === value.profileId && profile.kind === value.kind)
    : context.profile;
  const update = (patch: Partial<GenerationInput>) =>
    onChange ? onChange({ ...input, ...patch }) : context.update(patch);
  const selectProfile = (profile: Profile) =>
    onChange ? onChange(inputForProfile(input, profile)) : context.selectProfile(profile);
  const available = profiles.filter((p) => p.kind === input.kind);
  const families = unique(available.map(family));
  const inFamily = available.filter((p) => family(p) === (profile ? family(profile) : families[0]));
  const models = unique(inFamily.map(model));
  const inModel = inFamily.filter((p) => model(p) === (profile ? model(profile) : models[0]));
  const workers = catalogue.data?.workers || [];
  const worker = workers.find((value) => value.id === input.backendId);
  return (
    <Accordion variant="contained" radius="md" className="studio-profile-picker">
      <Accordion.Item value="model">
        <Accordion.Control aria-label="Choose Profile" data-profile-picker>
          <Text size="xs" c="dimmed">
            Profile
          </Text>
          <Stack gap={2}>
            <Text size="sm" fw={500} truncate>
              {profile ? model(profile) : "Choose a Profile"}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed" truncate>
                {profile
                  ? `${family(profile)} · ${preset(profile)}`
                  : "Family, model and workflow preset"}
              </Text>
              {worker && (
                <Text size="xs" c={worker.available ? "green" : "dimmed"} style={{ flexShrink: 0 }}>
                  {worker.available ? "Available" : "Offline"}
                </Text>
              )}
            </Group>
          </Stack>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Select
                comboboxProps={{ withinPortal: true }}
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
                comboboxProps={{ withinPortal: true }}
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
                comboboxProps={{ withinPortal: true }}
                label="Fast, Quality & Workflow Preset"
                searchable
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
                comboboxProps={{ withinPortal: true }}
                data={profile.workerIds.map((id) => {
                  const worker = workers.find((value) => value.id === id);
                  return {
                    value: id,
                    label: worker
                      ? `${worker.name} · ${worker.available ? "Available" : "Offline"}`
                      : id,
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
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
