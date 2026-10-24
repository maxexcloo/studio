import { Badge, Button, ColorSwatch, ComboboxPopover, Group, Text } from "@mantine/core";
import { ChevronDown } from "lucide-react";
import { inputForProfile, useGeneration } from "./GenerationProvider";
import type { GenerationInput, Models, Profile } from "../../types";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { chipProps } from "./chip";
import classes from "./GenerationInputControls.module.css";

/** Readiness from the profile's files and its assigned workers; unknown placement shows nothing. */
function profileReadiness(profile: Profile, workers: Models["workers"]) {
  if (profile.ready === false) return { label: "Needs Setup", color: "yellow" };
  const assigned = workers?.filter((worker) => profile.workerIds?.includes(worker.id));
  if (!assigned?.length) return undefined;
  return assigned.some((worker) => worker.available)
    ? { label: "Ready", color: "green" }
    : { label: "Offline", color: "red" };
}

export function ProfilePicker({
  value,
  onChange,
}: { value?: GenerationInput; onChange?: (value: GenerationInput) => void } = {}) {
  const context = useGeneration();
  const input = value || context.input;
  const workers = context.models.data?.workers;
  const available = context.profiles.filter((profile) => profile.kind === input.kind);
  const selected = available.find((profile) => profile.id === input.profileId);
  const families = [
    ...new Set(available.map((profile) => modelFamilyLabel(profile.family, profile.familyName))),
  ].sort((a, b) => a.localeCompare(b));
  const readiness = selected && profileReadiness(selected, workers);
  return (
    <ComboboxPopover
      searchable
      allowDeselect={false}
      withCheckIcon={false}
      maxDropdownHeight={320}
      nothingFoundMessage="No Matching Profiles"
      comboboxProps={{ width: 320, position: "top-start", withinPortal: true }}
      data={families.map((family) => ({
        group: family,
        items: available
          .filter((profile) => modelFamilyLabel(profile.family, profile.familyName) === family)
          .map((profile) => ({ value: profile.id, label: profile.displayName || profile.label })),
      }))}
      value={selected?.id ?? null}
      renderOption={({ option, checked }) => {
        const profile = available.find((profile) => profile.id === option.value);
        const status = profile && profileReadiness(profile, workers);
        return (
          <Group justify="space-between" wrap="nowrap" gap="xs" w="100%">
            <Text size="sm" fw={checked ? 600 : undefined} truncate>
              {option.label}
            </Text>
            {status && status.label !== "Ready" && (
              <Badge size="xs" variant="light" color={status.color}>
                {status.label}
              </Badge>
            )}
          </Group>
        );
      }}
      onChange={(id) => {
        const profile = available.find((profile) => profile.id === id);
        if (!profile) return;
        if (onChange) onChange(inputForProfile(input, profile));
        else context.selectProfile(profile);
      }}
    >
      <ComboboxPopover.Target>
        <Button
          aria-label="Profile"
          data-profile-picker
          {...chipProps}
          leftSection={
            readiness && (
              <ColorSwatch
                component="span"
                size={8}
                withShadow={false}
                color={`var(--mantine-color-${readiness.color}-6)`}
                aria-hidden
              />
            )
          }
          rightSection={<ChevronDown size={14} />}
          title={readiness ? readiness.label : undefined}
        >
          <span className={classes.label}>
            {selected ? selected.displayName || selected.label : "Choose a Profile"}
          </span>
        </Button>
      </ComboboxPopover.Target>
    </ComboboxPopover>
  );
}
