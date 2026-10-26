import type { GenerationInput, Profile, ReferenceAsset } from "../../types";

export function referenceDetails(
  references: ReferenceAsset[],
  input: GenerationInput,
  profile?: Profile,
) {
  return references.map((asset, index) => ({
    ...asset,
    slot:
      asset.slot ||
      (input.referenceAssets?.[index]?.assetId === asset.id
        ? input.referenceAssets[index].slot
        : undefined) ||
      profile?.mediaInputs?.[0]?.id ||
      "image",
  }));
}
type ReferenceSlot = NonNullable<Profile["mediaInputs"]>[number];

export function referenceGroups(profile?: Profile): ReferenceSlot[][] {
  const groups: ReferenceSlot[][] = [];
  for (const slot of profile?.mediaInputs?.length
    ? profile.mediaInputs
    : [{ id: "image", label: "Image", max: 1 }]) {
    const group = slot.follows
      ? groups.find(
          (items) => items[0].role === slot.role && items.some((item) => item.id === slot.follows),
        )
      : undefined;
    if (group) group.push(slot);
    else groups.push([slot]);
  }
  return groups;
}

export function referenceGroup(profile?: Profile, slot?: string) {
  const groups = referenceGroups(profile);
  return groups.find((group) => group.some((input) => input.id === slot)) || groups[0];
}

export function referenceCapacity(group: ReferenceSlot[]) {
  return group.reduce((total, input) => total + (input.max || 1), 0);
}

export function referenceGroupAssets(references: ReferenceAsset[], group: ReferenceSlot[]) {
  return references.filter((asset) => group.some((slot) => slot.id === asset.slot));
}

export function addReference(
  references: ReferenceAsset[],
  asset: ReferenceAsset,
  profile?: Profile,
  slot = profile?.mediaInputs?.[0]?.id || "image",
) {
  const group = referenceGroup(profile, slot);
  const duplicate = referenceGroupAssets(references, group).find(
    (reference) => reference.id === asset.id,
  );
  if (duplicate) return references;
  // An independent single-image role replaces; a linked stack fills its next free declared slot.
  if (referenceCapacity(group) === 1) {
    const replaced = references.findIndex((reference) => reference.slot === group[0].id);
    return replaced < 0
      ? [...references, { ...asset, slot: group[0].id }]
      : references.map((reference, index) =>
          index === replaced ? { ...asset, slot: group[0].id } : reference,
        );
  }
  const target = group.find(
    (input) =>
      references.filter((reference) => reference.slot === input.id).length < (input.max || 1),
  );
  return target ? [...references, { ...asset, slot: target.id }] : references;
}

export function generationInput(
  input: GenerationInput,
  profile: Profile | undefined,
  references: ReferenceAsset[],
) {
  const details = referenceDetails(references, input, profile);
  const large =
    input.kind === "image" &&
    (Math.max(input.width, input.height) >= 2048 || input.width * input.height >= 2048 * 1152);
  return {
    ...input,
    // 2K and larger draws decode in tiles, matching MCP's generation path.
    ...(large ? { tiledDecode: true } : {}),
    profileId: profile?.id || input.profileId,
    model: profile?.model || input.model,
    workflow: profile?.workflow || input.workflow,
    provider: profile?.provider,
    backendId:
      profile?.provider === "cliproxyapi" ? undefined : input.backendId || profile?.workerIds?.[0],
    profileName: profile?.displayName || profile?.label,
    referenceAssets: references.length
      ? details.map((asset) => ({ assetId: asset.id, slot: asset.slot! }))
      : input.referenceAssets,
    referenceDetails: details,
  };
}

export function primaryReference(references: ReferenceAsset[], profile?: Profile) {
  const slot =
    profile?.mediaInputs?.find((slot) => slot.role === "start") || profile?.mediaInputs?.[0];
  return slot ? references.find((asset) => asset.slot === slot.id) : references[0];
}
export function referencePatch(
  input: GenerationInput,
  previous: ReferenceAsset[],
  next: ReferenceAsset[],
  profile?: Profile,
) {
  const details = referenceDetails(next, input, profile);
  return {
    referenceDetails: details,
    referenceAssets: details.map((asset) => ({ assetId: asset.id, slot: asset.slot })),
    ...(primaryReference(referenceDetails(previous, input, profile), profile)?.id !==
    primaryReference(details, profile)?.id
      ? { inpaint: undefined }
      : {}),
  };
}

/** An adjustable numeric control's range, or null where the profile fixes or ignores it. */
export function controlRange(
  profile: Profile | undefined,
  key: string,
  fallback: { min?: number; max?: number; step?: number } = {},
) {
  if (profile?.capabilities[key] === false) return null;
  const range = { ...fallback, ...profile?.constraints?.[key] };
  return range.min !== undefined && range.min === range.max ? null : range;
}

/** The one Steps rule for every surface: shown only where the profile lets it change. */
export const stepsRange = (profile?: Profile) =>
  controlRange(profile, "steps", { min: 1, max: 200 });
