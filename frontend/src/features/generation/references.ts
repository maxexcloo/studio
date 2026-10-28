import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import type { GenerationInput, MediaItem, Profile, ReferenceAsset } from "../../types";
import {
  addReference,
  referenceCapacity,
  referenceDetails,
  referenceGroup,
  referenceGroupAssets,
  referenceGroups,
  referencePatch,
} from "./payload";
import { useGeneration } from "./GenerationProvider";

export const galleryReferenceType = "application/x-studio-gallery-item";
export const referenceKey = (asset: ReferenceAsset) => `${asset.slot}:${asset.id}`;
export function referenceLabel(asset: ReferenceAsset, index: number, profile?: Profile) {
  const role = profile?.mediaInputs?.find((input) => input.id === asset.slot)?.label;
  return `Reference ${index + 1}${role ? ` · ${role}` : ""}`;
}

/** Where the next reference goes: a role group's first slot, or one placed reference to replace. */
export interface ReferenceTarget {
  slot: string;
  replace?: string;
}

/** References in slot order, keeping the chosen order within each role. */
export function orderedReferences(references: ReferenceAsset[], profile?: Profile) {
  const groups = referenceGroups(profile);
  const rank = (asset: ReferenceAsset) => {
    const index = groups.findIndex((group) => group.some((slot) => slot.id === asset.slot));
    return index < 0 ? groups.length : index;
  };
  return references
    .map((asset, index) => ({ asset, index, rank: rank(asset) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ asset }) => asset);
}

/**
 * The numbered drop targets: each role's placed references, then one empty cell while it has room.
 * Numbers follow slot order, so an empty cell shows the number its reference will get.
 */
export function referenceCells(references: ReferenceAsset[], profile?: Profile) {
  let number = 0;
  return referenceGroups(profile).map((group) => {
    const assets = referenceGroupAssets(references, group);
    const capacity = referenceCapacity(group);
    return {
      slot: group[0].id,
      // Unlabelled slots read by their ID, such as Start or Image.
      label: group[0].label || group[0].id.replace(/^\w/, (letter) => letter.toUpperCase()),
      required: group.some((input) => input.required),
      capacity,
      assets,
      cells: [
        ...assets.map((asset) => ({ asset, number: ++number })),
        ...(assets.length < capacity ? [{ asset: undefined, number: ++number }] : []),
      ],
    };
  });
}

/** A chosen target, else the first role with room, else the only single-image role (replaced). */
export function nextReferenceTarget(
  references: ReferenceAsset[],
  profile?: Profile,
  chosen?: ReferenceTarget | null,
): ReferenceTarget | null {
  const groups = referenceGroups(profile);
  const room = (group: (typeof groups)[number]) =>
    referenceGroupAssets(references, group).length < referenceCapacity(group);
  if (chosen?.replace && references.some((asset) => referenceKey(asset) === chosen.replace))
    return chosen;
  const group = groups.find((items) => items[0].id === chosen?.slot);
  if (group && (room(group) || referenceCapacity(group) === 1)) return { slot: group[0].id };
  const open = groups.find(room);
  if (open) return { slot: open[0].id };
  return groups.length === 1 && referenceCapacity(groups[0]) === 1
    ? { slot: groups[0][0].id }
    : null;
}

export function placeReference(
  references: ReferenceAsset[],
  asset: ReferenceAsset,
  profile: Profile | undefined,
  target: ReferenceTarget,
) {
  const index = target.replace
    ? references.findIndex((reference) => referenceKey(reference) === target.replace)
    : -1;
  if (index < 0) {
    const added = addReference(references, asset, profile, target.slot);
    return added === references ? references : orderedReferences(added, profile);
  }
  const slot = references[index].slot;
  const group = referenceGroup(profile, slot);
  if (referenceGroupAssets(references, group).some((reference) => reference.id === asset.id))
    return references;
  return references.map((reference, position) =>
    position === index ? { ...asset, slot } : reference,
  );
}

/** Reads and replaces references for an editor's own value, or the shared gallery draft. */
export function useReferenceList({
  value,
  onChange,
  profile: selectedProfile,
  input,
}: {
  value?: ReferenceAsset[];
  onChange?: (references: ReferenceAsset[]) => void;
  profile?: Profile;
  input?: GenerationInput;
} = {}) {
  const { form, setDraft, profile: draftProfile } = useGeneration();
  const profile = selectedProfile || draftProfile;
  const own = useRef<ReferenceAsset[]>([]);
  if (value) own.current = value;
  function get() {
    const draft = form.getValues();
    return orderedReferences(
      onChange
        ? referenceDetails(own.current, input || draft.input, profile)
        : referenceDetails(draft.references, draft.input, profile),
      profile,
    );
  }
  function set(references: ReferenceAsset[]) {
    if (onChange) {
      own.current = references;
      onChange(references);
    } else
      setDraft((previous) => ({
        ...previous,
        references,
        input: {
          ...previous.input,
          ...referencePatch(previous.input, previous.references, references, profile),
        },
      }));
  }
  return { profile, get, set };
}
type ReferenceList = ReturnType<typeof useReferenceList>;

/** Taps, drops and pastes fill the chosen target, else the next empty slot. */
export function useReferencePlacement(list: ReferenceList) {
  const client = useQueryClient();
  const upload = useMutation({
    mutationKey: ["reference-upload"],
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("image", file);
      return (
        await api<{ asset: ReferenceAsset }>("/api/reference-assets/upload", {
          method: "POST",
          body: form,
        })
      ).asset;
    },
    // An upload is a gallery image, listed under the Uploads filter.
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["reference-gallery"] });
      await client.invalidateQueries({ queryKey: ["gallery"] });
    },
  });
  const gallery = useMutation({
    mutationFn: ({ id, type }: Pick<MediaItem, "id" | "type">) =>
      post<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", {
        galleryItemId: id,
        ...(type === "video" ? { frame: "last" } : {}),
      }),
  });
  function place(asset: ReferenceAsset, chosen?: ReferenceTarget | null) {
    const references = list.get();
    const target = nextReferenceTarget(references, list.profile, chosen);
    if (target) list.set(placeReference(references, asset, list.profile, target));
  }
  async function uploadFiles(files: File[], chosen?: ReferenceTarget | null) {
    for (const file of files.filter((file) => file.type.startsWith("image/"))) {
      if (!nextReferenceTarget(list.get(), list.profile, chosen)) break;
      const asset = await upload.mutateAsync(file).catch(() => undefined);
      if (!asset) break;
      place(asset, chosen);
      chosen = null;
    }
  }
  function addGalleryItem(
    item: Pick<MediaItem, "id" | "type">,
    chosen?: ReferenceTarget | null,
    onAdded?: () => void,
  ) {
    gallery.mutate(item, {
      onSuccess: ({ asset }) => {
        place(asset, chosen);
        onAdded?.();
      },
    });
  }
  return {
    place,
    uploadFiles,
    addGalleryItem,
    uploading: upload.isPending,
    adding: gallery.isPending,
  };
}

/** The composer's paste and drop targets fill the gallery draft's next empty slots. */
export function useReferenceFiles() {
  return useReferencePlacement(useReferenceList());
}

export function useGalleryReference() {
  const placement = useReferencePlacement(useReferenceList());
  return {
    mutate: (item: Pick<MediaItem, "id" | "type">, options?: { onSuccess?: () => void }) =>
      placement.addGalleryItem(item, null, options?.onSuccess),
    isPending: placement.adding,
  };
}
