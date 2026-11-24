import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { editsReferences } from "../../../../shared/characters";
import type { MediaKind } from "../../types";
import type { Action } from "../../ui/ActionBar";
import { useRemembered } from "../auth/useRemembered";
import { modelsQuery } from "../generation/GenerationProvider";
import { profileForBackend, takesReferences } from "../generation/payload";
import { profileOptions } from "../generation/ProfilePicker";
import { referenceProfilePriority } from "./editProfile";

export function useActionProfile(kind: MediaKind) {
  const [saved, select] = useRemembered<string | null>(
    `${kind === "image" ? "edit" : "animate"}-profile`,
    null,
  );
  const profiles = useQuery(modelsQuery).data?.profiles;
  const options = useMemo(() => {
    const eligible = (profiles || []).filter((profile) => {
      const run = profileForBackend(profile, undefined, true);
      return (
        profile.kind === kind &&
        run &&
        run.ready !== false &&
        takesReferences(profile) &&
        (kind === "video" || editsReferences(run))
      );
    });
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
