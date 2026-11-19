import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { isCloudProfile } from "../../../../shared/profiles.ts";
import type { MediaItem, MediaKind, Profile } from "../../types";
import type { Action } from "../../ui/ActionBar";
import { useRemembered } from "../auth/useRemembered";
import { modelsQuery } from "../generation/GenerationProvider";
import { isProfile, profileForBackend, takesReferences } from "../generation/payload";
import { profileOptions } from "../generation/ProfilePicker";

export function referenceProfilePriority(profile: Profile) {
  const run = profileForBackend(profile, undefined, true)!;
  if (profile.availability || run.ready === false) return 3;
  if (isCloudProfile(profile)) return 2;
  return run.backend === "radiance" ? 0 : 1;
}

export function automaticEditProfile(profiles: Profile[], item: MediaItem) {
  const compatible = profiles.filter(
    (profile) => profile.kind === item.type && takesReferences(profile),
  );
  const priorId = item.settings?.profileId;
  const original = compatible.find((profile) =>
    priorId ? isProfile(profile, priorId) : profile.model === item.model,
  );
  const ready = compatible.filter((profile) => referenceProfilePriority(profile) < 3);
  if (original && referenceProfilePriority(original) < 3) ready.unshift(original);
  return ready.sort(
    (left, right) => referenceProfilePriority(left) - referenceProfilePriority(right),
  )[0];
}

export function useActionProfile(kind: MediaKind) {
  const [saved, select] = useRemembered<string | null>(
    `${kind === "image" ? "edit" : "animate"}-profile`,
    null,
  );
  const profiles = useQuery(modelsQuery).data?.profiles;
  const options = useMemo(() => {
    const eligible = (profiles || []).filter(
      (profile) =>
        profile.kind === kind &&
        profileForBackend(profile, undefined, true)?.ready !== false &&
        takesReferences(profile),
    );
    const priorities = new Map(
      eligible.map((profile) => [profile.id, referenceProfilePriority(profile)]),
    );
    return profileOptions(eligible)
      .flatMap(({ items }) => items)
      .sort((left, right) => priorities.get(left.value)! - priorities.get(right.value)!);
  }, [profiles, kind]);
  const current = options.find((option) => option.value === saved);
  const menu: Action[] = options.length
    ? [
        {
          id: `${kind}-action-profile`,
          label: "Profile",
          description: current?.label || "Automatic",
          menu: [
            [
              {
                id: "automatic",
                label: "Automatic",
                selected: !current,
                keepOpen: true,
                onClick: () => select(null),
              },
              ...options.map(({ label, value }) => ({
                id: value,
                label,
                selected: current?.value === value,
                keepOpen: true,
                onClick: () => select(value),
              })),
            ],
          ],
        },
      ]
    : [];
  return { menu, profileId: current?.value, profiles };
}
