import { Select } from "@mantine/core";
import { inputForProfile, useGeneration } from "./GenerationProvider";
import type { GenerationInput } from "../../types";
import { modelFamilyLabel } from "../../ui/modelFamily";

export function ProfilePicker({
  value,
  onChange,
}: { value?: GenerationInput; onChange?: (value: GenerationInput) => void } = {}) {
  const context = useGeneration();
  const input = value || context.input;
  const available = context.profiles.filter((profile) => profile.kind === input.kind);
  const families = [
    ...new Set(available.map((profile) => modelFamilyLabel(profile.family, profile.familyName))),
  ].sort((a, b) => a.localeCompare(b));
  return (
    <Select
      label="Profile"
      placeholder="Choose a Profile"
      searchable
      allowDeselect={false}
      data-profile-picker
      comboboxProps={{ withinPortal: true }}
      data={families.map((family) => ({
        group: family,
        items: available
          .filter((profile) => modelFamilyLabel(profile.family, profile.familyName) === family)
          .map((profile) => ({ value: profile.id, label: profile.displayName || profile.label })),
      }))}
      value={available.some((profile) => profile.id === input.profileId) ? input.profileId : null}
      onChange={(id) => {
        const profile = available.find((profile) => profile.id === id);
        if (!profile) return;
        if (onChange) onChange(inputForProfile(input, profile));
        else context.selectProfile(profile);
      }}
    />
  );
}
