import type { GenerationInput, Profile, ReferenceAsset } from "../../types";

export function generationInput(
  input: GenerationInput,
  profile: Profile | undefined,
  references: ReferenceAsset[],
) {
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
      ? references.map((asset, i) => ({
          assetId: asset.id,
          slot: profile?.mediaInputs?.[i]?.id || profile?.mediaInputs?.[0]?.id || "image",
        }))
      : input.referenceAssets,
    referenceDetails: references,
  };
}
