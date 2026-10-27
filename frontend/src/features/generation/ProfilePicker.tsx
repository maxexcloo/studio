import { Badge, Button, ColorSwatch, ComboboxPopover, Group, Text } from "@mantine/core";
import { ChevronDown } from "lucide-react";
import { inputForProfile, useGeneration } from "./GenerationProvider";
import type { GenerationInput, Models, Profile } from "../../types";
import { backendLabel, isProfile } from "./payload";
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

const profileName = (profile: Profile) => profile.displayName || profile.label;

/** A shared name gains the part of the profile ID that differs, such as "· fp8" or "· comfyui". */
function profileLabel(profile: Profile, profiles: Profile[]) {
  const name = profileName(profile);
  const twins = profiles.filter((other) => profileName(other) === name);
  if (twins.length < 2) return name;
  const words = (other: Profile) => other.id.replace(/^custom:/, "").split("-");
  const own = words(profile);
  const others = twins.map(words);
  const shared = (at: (parts: string[]) => string | undefined) =>
    others.every((parts) => at(parts) === at(own));
  let start = 0;
  while (start < own.length - 1 && shared((parts) => parts[start])) start++;
  let end = own.length;
  while (end - 1 > start && shared((parts) => parts.at(end - own.length - 1))) end--;
  return `${name} · ${own.slice(start, end).join("-")}`;
}

export function ProfilePicker({
  value,
  onChange,
}: { value?: GenerationInput; onChange?: (value: GenerationInput) => void } = {}) {
  const context = useGeneration();
  const input = value || context.input;
  const workers = context.models.data?.workers;
  const available = context.profiles.filter((profile) => profile.kind === input.kind);
  const selected = available.find((profile) => isProfile(profile, input.profileId));
  const selectedLabel = selected && profileLabel(selected, available);
  const families = [
    ...new Set(available.map((profile) => modelFamilyLabel(profile.family, profile.familyName))),
  ].sort((a, b) => a.localeCompare(b));
  const readiness = selected && profileReadiness(selected, workers);
  // A combined profile's run uses the input's backend (a rerun keeps the one that ran), else the profile's.
  const selectedBackend = selected?.backend && (input.profileBackend || selected.backend);
  return (
    <ComboboxPopover
      searchable
      allowDeselect={false}
      withCheckIcon={false}
      maxDropdownHeight={320}
      nothingFoundMessage="No Matching Profiles"
      comboboxProps={{
        width: "min(440px, 100vw - 32px)",
        position: "top-start",
        withinPortal: true,
      }}
      data={families.map((family) => ({
        group: family,
        items: available
          .filter((profile) => modelFamilyLabel(profile.family, profile.familyName) === family)
          .map((profile) => ({ value: profile.id, label: profileLabel(profile, available) })),
      }))}
      value={selected?.id ?? null}
      renderOption={({ option, checked }) => {
        const profile = available.find((profile) => profile.id === option.value);
        const status = profile && profileReadiness(profile, workers);
        return (
          <Group justify="space-between" wrap="nowrap" gap="xs" w="100%">
            <Text size="sm" fw={checked ? 600 : undefined} lineClamp={2} title={option.label}>
              {option.label}
            </Text>
            <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
              {profile?.backend && (
                <Badge size="xs" variant="default" title={profile.readyReason}>
                  {backendLabel(
                    profile.id === selected?.id && selectedBackend
                      ? selectedBackend
                      : profile.backend,
                  )}
                </Badge>
              )}
              {profile?.aiDrafted && (
                <Badge size="xs" variant="light" color="orange">
                  AI-Drafted
                </Badge>
              )}
              {status && status.label !== "Ready" && (
                <Badge size="xs" variant="light" color={status.color}>
                  {status.label}
                </Badge>
              )}
            </Group>
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
          title={
            selectedLabel &&
            [
              selectedLabel,
              selectedBackend && backendLabel(selectedBackend),
              readiness?.label,
              selected?.readyReason,
            ]
              .filter(Boolean)
              .join(" · ")
          }
        >
          <span className={classes.label}>{selectedLabel || "Choose a Profile"}</span>
          {selectedBackend && (
            <Badge size="xs" variant="default" ml={6}>
              {backendLabel(selectedBackend)}
            </Badge>
          )}
        </Button>
      </ComboboxPopover.Target>
    </ComboboxPopover>
  );
}
