import { Badge } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { isCloudProfile, slotCapacity } from "../../../../shared/profiles";
import type { GenerationInput, Models, Profile } from "../../types";
import { compareNames } from "../../ui/DataTable";
import { plural } from "../../ui/plural";
import { useIsAdmin } from "../auth/AccountGate";
import { servicesStatusQuery } from "../runtime/RuntimePanel";
import { useWorkloadStart } from "../runtime/WorkloadStart";
import { ChipOption, ChipSelect, type ChipSelectProps } from "./ChipSelect";
import {
  defaultProfile,
  inputForProfile,
  modelsQuery,
  useDraft,
  useGeneration,
} from "./GenerationProvider";
import { modelFamilyLabel } from "./modelFamily";
import { backendLabel, isProfile, profileName } from "./payload";

/**
 * Readiness from the profile's files and its assigned workers; unknown placement shows nothing.
 * Workers stopped on purpose read Stopped, with the workloads an administrator can start.
 */
function profileReadiness(profile: Profile, workers: Models["workers"]) {
  if (profile.ready === false) return { label: "Needs Setup", color: "yellow" };
  const assigned = workers?.filter((worker) => profile.workerIds?.includes(worker.id));
  if (!assigned?.length) return undefined;
  if (assigned.some((worker) => worker.available)) return { label: "Ready", color: "green" };
  return assigned.every((worker) => worker.parked)
    ? {
        label: "Stopped",
        color: "gray",
        workloads: assigned.flatMap((worker) => worker.workloads ?? []),
      }
    : { label: "Offline", color: "red" };
}

/**
 * Each profile's readiness for this account; a cloud profile reads Near Limit while cloud work
 * holds back near its usage limit, though choosing one still runs it.
 */
function useReadiness() {
  const workers = useQuery(modelsQuery).data?.workers;
  const cloudHeld = useQuery(servicesStatusQuery).data?.cloudHeld;
  return (profile: Profile) =>
    cloudHeld && isCloudProfile(profile) && profile.ready !== false
      ? { label: "Near Limit", color: "yellow" }
      : profileReadiness(profile, workers);
}

/**
 * What sets a profile apart, for its option's subtitle: its references (edited or guiding), a
 * negative prompt, LoRAs and its other abilities, then Cloud.
 */
function profileAbilities(profile: Profile) {
  const { capabilities: can } = profile;
  const references = Math.max(
    slotCapacity(profile.mediaInputs ?? []),
    ...(profile.backendOptions ?? []).map((option) => option.references),
  );
  return [
    references > 0 && plural(references, "Reference"),
    profile.kind === "image" && references > 0 && profile.editReferences && "Edit",
    can.inpaint && "Inpaint",
    profile.kind === "image" && can.negativePrompt !== false && "Negative",
    can.lora && "LoRAs",
    can.sound && "Sound",
    can.transparent && "Transparent",
    profile.native?.["4k"] === "yes" ? "4K" : profile.native?.["2k"] === "yes" && "2K",
    isCloudProfile(profile) && "Cloud",
  ];
}

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

/** Profiles grouped by readable family name, for every profile selector. */
export function profileOptions(available: Profile[]) {
  const family = (profile: Profile) => modelFamilyLabel(profile.family, profile.familyName);
  return [...new Set(available.map(family))].sort(compareNames).map((group) => ({
    group,
    items: available
      .filter((profile) => family(profile) === group)
      .map((profile) => ({ value: profile.id, label: profileLabel(profile, available) }))
      .sort((a, b) => compareNames(a.label, b.label)),
  }));
}

/**
 * Every profile choice: a chip in the composer, or a `field` in a Settings row, listing `profiles`
 * by family with their readable names, facts and readiness. `unset` names the choice of none (a
 * setting's default), shown as a placeholder with `clearable` or listed first.
 */
export function ProfileSelect({
  name,
  profiles,
  value,
  onChange,
  unset,
  clearable,
  ...trigger
}: {
  name: string;
  profiles: Profile[];
  value: string | null;
  onChange: (profile: Profile | null) => void;
  unset?: string;
} & Partial<
  Pick<
    ChipSelectProps,
    "field" | "clearable" | "disabled" | "swatch" | "title" | "target" | "label"
  >
>) {
  const readinessOf = useReadiness();
  const selected = profiles.find((profile) => isProfile(profile, value ?? undefined));
  const selectedLabel = selected && profileLabel(selected, profiles);
  const readiness = selected && readinessOf(selected);
  return (
    <ChipSelect
      name={name}
      searchable
      clearable={clearable}
      nothingFoundMessage="No Matches"
      data={[
        ...(unset && !clearable ? [{ value: "", label: unset }] : []),
        ...profileOptions(profiles),
      ]}
      value={selected?.id ?? (value || (unset && !clearable ? "" : null))}
      renderOption={({ option, checked }) => {
        const profile = profiles.find((profile) => profile.id === option.value);
        const status = profile && readinessOf(profile);
        // Its name's first part titles it; the rest (speed, steps) and its abilities follow.
        const [title, ...rest] = option.label.split(" · ");
        return (
          <ChipOption
            label={title}
            description={
              profile && [...rest, ...profileAbilities(profile)].filter(Boolean).join(" · ")
            }
            checked={checked}
            badges={
              <>
                {profile?.aiDrafted && (
                  <Badge size="xs" color="orange">
                    AI
                  </Badge>
                )}
                {profile?.failing && (
                  <Badge size="xs" color="red" title="Most of its runs in the last week failed">
                    Failing
                  </Badge>
                )}
                {status && status.label !== "Ready" && (
                  <Badge size="xs" color={status.color}>
                    {status.label}
                  </Badge>
                )}
              </>
            }
          />
        );
      }}
      onChange={(id) => onChange(profiles.find((profile) => profile.id === id) ?? null)}
      swatch={readiness?.color}
      title={selectedLabel && [selectedLabel, readiness?.label].filter(Boolean).join(" · ")}
      label={selectedLabel || value || unset || "Choose a Model"}
      {...trigger}
    />
  );
}

export function ProfilePicker({
  value,
  onChange,
  startParked = false,
}: {
  value?: GenerationInput;
  onChange?: (value: GenerationInput) => void;
  /** An administrator choosing a parked profile also starts its worker. */
  startParked?: boolean;
} = {}) {
  const context = useGeneration();
  const client = useQueryClient();
  const admin = useIsAdmin();
  const runtime = useWorkloadStart(admin && startParked);
  const readinessOf = useReadiness();
  const failure = runtime.starting?.error;
  useEffect(() => {
    if (!failure) return;
    notifications.show({ color: "red", message: failure });
    runtime.dismiss();
  }, [failure]);
  const draft = useDraft();
  const input = value || draft.input;
  const workers = context.models.data?.workers;
  const available = context.profiles.filter((profile) => profile.kind === input.kind);
  const selected = input.profileId
    ? available.find((profile) => isProfile(profile, input.profileId))
    : defaultProfile(context.models.data, input.kind);
  const selectedLabel = selected && profileLabel(selected, available);
  const readiness = selected && readinessOf(selected);
  // A combined profile's run uses the input's backend (a rerun keeps the one that ran), else the
  // profile's; only the composer's Backend chip shows it, where it is switched.
  const selectedBackend = selected?.backend && (input.profileBackend || selected.backend);
  return (
    <>
      <ProfileSelect
        name="Model"
        target={{ "data-profile-picker": true }}
        profiles={available}
        value={selected?.id ?? null}
        onChange={(profile) => {
          if (!profile) return;
          if (onChange) onChange(inputForProfile(input, profile));
          else context.selectProfile(profile);
          const parked = profileReadiness(profile, workers)?.workloads;
          if (admin && startParked && parked?.length) {
            const name = profileName(profile);
            void runtime.start(parked, name, () =>
              client.invalidateQueries({ queryKey: modelsQuery.queryKey }),
            );
          }
        }}
        swatch={runtime.starting && !failure ? "yellow" : readiness?.color}
        title={
          selectedLabel &&
          [
            selectedLabel,
            selectedBackend && backendLabel(selectedBackend),
            runtime.starting && !failure
              ? `Starting: ${runtime.starting.progress}`
              : readiness?.label === "Stopped" && !admin
                ? "Stopped by an Administrator"
                : readiness?.label,
            selected?.readyReason,
          ]
            .filter(Boolean)
            .join(" · ")
        }
        label={selectedLabel || "Choose a Model"}
      />
      {runtime.dialog}
    </>
  );
}
