import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { profileBackendLabels, profileNameParts } from "../../../../shared/profiles";
import { withResolution } from "../../../../shared/resolution";

/** Whether `profile` is the one a recorded id names, including an id merged into it. */
export const isProfile = (profile: Profile, id: unknown) =>
  profile.id === id || (typeof id === "string" && Boolean(profile.aliases?.includes(id)));

/** Whether a run on `profile` takes a negative prompt. */
export const usesNegative = (profile?: Profile) =>
  Boolean(profile && profile.capabilities.negativePrompt !== false);

/** A combined profile's backend by name ("Radiance"). */
export const backendLabel = (id: string) => profileBackendLabels[id] || id;

/** A run's backend supplies its own settings, controls and reference slots. */
export function profileForBackend(profile: Profile | undefined, backend = profile?.backend) {
  const option = profile?.backendOptions?.find((option) => option.id === backend);
  return profile && option?.profile
    ? {
        ...option.profile,
        aliases: profile.aliases,
        aliasBackends: profile.aliasBackends,
        backendOptions: profile.backendOptions,
        failing: profile.failing,
        workerIds: profile.workerIds,
        ready: option.ready,
        readyReason: option.reason,
      }
    : profile;
}

/** Backend defaults follow the switch; settings the person changed remain their own. */
export function backendInputPatch(input: GenerationInput, profile: Profile, backend: string) {
  const next = profileForBackend(profile, backend)!;
  const patch: Partial<GenerationInput> = { profileBackend: backend };
  for (const [key, value] of Object.entries(next.defaults))
    if (input[key] === undefined || input[key] === profile.defaults[key]) patch[key] = value;
  return patch;
}

/** A profile name as lists show it, without a backend segment such as "· ComfyUI". */
export const shownProfileName = (name: string) => profileNameParts(name).join(" · ") || name;
export const profileName = (profile: Pick<Profile, "displayName" | "label">) =>
  shownProfileName(profile.displayName || profile.label);

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
/** The reference slots a profile declares, or a card's images (CardImages). */
export type SlotLayout = Pick<Profile, "mediaInputs">;

/** A placed reference as a run sends it: its asset, slot and any strength set. */
const referenceAsset = (asset: ReferenceAsset) => ({
  assetId: asset.id,
  slot: asset.slot!,
  ...(asset.strength !== undefined ? { strength: asset.strength } : {}),
});

export function referenceGroups(profile?: SlotLayout): ReferenceSlot[][] {
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

export function referenceGroup(profile?: SlotLayout, slot?: string) {
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
  profile?: SlotLayout,
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
  listedProfile: Profile | undefined,
  references: ReferenceAsset[],
) {
  const profile = profileForBackend(listedProfile, input.profileBackend);
  const details = referenceDetails(references, input, profile);
  // The size tier sets the size here as on the server, so the pending tile has the run's shape.
  const sized = withResolution(
    {
      ...input,
      referenceAssets: references.length ? details.map(referenceAsset) : input.referenceAssets,
    },
    profile,
  );
  const large =
    sized.kind === "image" &&
    (Math.max(sized.width, sized.height) >= 2048 || sized.width * sized.height >= 2048 * 1152);
  return {
    ...sized,
    // 2K and larger draws decode in tiles, matching MCP's generation path.
    ...(large ? { tiledDecode: true } : {}),
    profileId: profile?.id || input.profileId,
    model: profile?.model || input.model,
    workflow: profile?.workflow || input.workflow,
    provider: profile?.provider,
    profileName: profile?.displayName || profile?.label,
    referenceAssets: references.length ? details.map(referenceAsset) : input.referenceAssets,
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
  const before = referenceDetails(previous, input, profile);
  // The first reference switches the profile to its reference mode, which takes that mode's
  // settings (a partial denoise, as Edit does); removing the last one restores text-to-image's.
  const mode = profile?.imageModes?.reference?.defaults ?? {};
  const switched =
    !before.length && details.length
      ? mode
      : before.length && !details.length
        ? Object.fromEntries(
            Object.keys(mode)
              .filter((key) => key in profile!.defaults)
              .map((key) => [key, profile!.defaults[key]]),
          )
        : {};
  return {
    ...switched,
    referenceDetails: details,
    referenceAssets: details.map(referenceAsset),
    ...(primaryReference(before, profile)?.id !== primaryReference(details, profile)?.id
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
