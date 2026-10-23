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
export function addReference(
  references: ReferenceAsset[],
  asset: ReferenceAsset,
  profile?: Profile,
  slot = profile?.mediaInputs?.[0]?.id || "image",
) {
  const limit =
    profile?.mediaInputs?.find((input) => input.id === slot)?.max ||
    (profile?.mediaInputs?.length ? 1 : 8);
  const same = references.filter(
    (reference) => reference.slot === slot && reference.id !== asset.id,
  );
  const keep = references.filter((reference) => reference.slot !== slot);
  if (limit > 1 && same.length >= limit) return references;
  return [...keep, ...(limit > 1 ? same.slice(-(limit - 1)) : []), { ...asset, slot }];
}

export function generationInput(
  input: GenerationInput,
  profile: Profile | undefined,
  references: ReferenceAsset[],
) {
  const details = referenceDetails(references, input, profile);
  return {
    ...input,
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
