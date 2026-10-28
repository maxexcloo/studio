import { useEffect } from "react";
import { Badge } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useIsAdmin } from "../auth/AccountGate";
import { useWorkloadStart } from "../runtime/WorkloadStart";
import { inputForProfile, modelsQuery, useGeneration } from "./GenerationProvider";
import type { GenerationInput, Models, Profile } from "../../types";
import { backendLabel, isProfile } from "./payload";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { ChipOption, ChipSelect } from "./ChipSelect";

/**
 * Readiness from the profile's files and its assigned workers; unknown placement shows nothing.
 * Workers stopped on purpose are Parked, with the workloads an administrator can start.
 */
function profileReadiness(profile: Profile, workers: Models["workers"]) {
  if (profile.ready === false) return { label: "Needs Setup", color: "yellow" };
  const assigned = workers?.filter((worker) => profile.workerIds?.includes(worker.id));
  if (!assigned?.length) return undefined;
  if (assigned.some((worker) => worker.available)) return { label: "Ready", color: "green" };
  return assigned.every((worker) => worker.parked)
    ? {
        label: "Parked",
        color: "gray",
        workloads: assigned.flatMap((worker) => worker.workloads ?? []),
      }
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

/** Profiles grouped by readable family name, for every profile selector. */
export function profileOptions(available: Profile[]) {
  const family = (profile: Profile) => modelFamilyLabel(profile.family, profile.familyName);
  return [...new Set(available.map(family))]
    .sort((a, b) => a.localeCompare(b))
    .map((group) => ({
      group,
      items: available
        .filter((profile) => family(profile) === group)
        .map((profile) => ({ value: profile.id, label: profileLabel(profile, available) })),
    }));
}

export function ProfilePicker({
  value,
  onChange,
  startParked = false,
}: {
  value?: GenerationInput;
  onChange?: (value: GenerationInput) => void;
  /** An administrator choosing a parked profile also starts its worker, as a Chat model does. */
  startParked?: boolean;
} = {}) {
  const context = useGeneration();
  const client = useQueryClient();
  const admin = useIsAdmin();
  const runtime = useWorkloadStart(admin && startParked);
  const failure = runtime.starting?.error;
  useEffect(() => {
    if (!failure) return;
    notifications.show({ color: "red", message: failure });
    runtime.dismiss();
  }, [failure]);
  const input = value || context.input;
  const workers = context.models.data?.workers;
  const available = context.profiles.filter((profile) => profile.kind === input.kind);
  const selected = available.find((profile) => isProfile(profile, input.profileId));
  const selectedLabel = selected && profileLabel(selected, available);
  const readiness = selected && profileReadiness(selected, workers);
  // A combined profile's run uses the input's backend (a rerun keeps the one that ran), else the
  // profile's; with several to choose from, the Backend chip shows it instead.
  const selectedBackend = selected?.backend && (input.profileBackend || selected.backend);
  const backendBadge = selectedBackend && (selected.backendOptions?.length || 0) < 2;
  return (
    <>
      <ChipSelect
        name="Profile"
        target={{ "data-profile-picker": true }}
        searchable
        nothingFoundMessage="No Matching Profiles"
        data={profileOptions(available)}
        value={selected?.id ?? null}
        renderOption={({ option, checked }) => {
          const profile = available.find((profile) => profile.id === option.value);
          const status = profile && profileReadiness(profile, workers);
          return (
            <ChipOption
              label={option.label}
              description={profile?.description}
              checked={checked}
              badges={
                <>
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
                    <Badge size="xs" color="orange">
                      AI-Drafted
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
        onChange={(id) => {
          const profile = available.find((profile) => profile.id === id);
          if (!profile) return;
          if (onChange) onChange(inputForProfile(input, profile));
          else context.selectProfile(profile);
          const parked = profileReadiness(profile, workers)?.workloads;
          if (admin && startParked && parked?.length) {
            const name = profileName(profile);
            void runtime.start(parked, name, () => {
              notifications.show({ message: `${name} is ready.` });
              void client.invalidateQueries({ queryKey: modelsQuery.queryKey });
            });
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
              : readiness?.label === "Parked" && !admin
                ? "Parked by an Administrator"
                : readiness?.label,
            selected?.readyReason,
          ]
            .filter(Boolean)
            .join(" · ")
        }
        label={selectedLabel || "Choose a Profile"}
        badge={
          backendBadge && (
            <Badge size="xs" variant="default" ml={6}>
              {backendLabel(selectedBackend)}
            </Badge>
          )
        }
      />
      {runtime.dialog}
    </>
  );
}
