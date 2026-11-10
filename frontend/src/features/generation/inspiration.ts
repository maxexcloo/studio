import { queryOptions } from "@tanstack/react-query";
import { api } from "../../api";
import type { GenerationInput, Profile } from "../../types";
import { inputForProfile } from "./GenerationProvider";

/**
 * Inspiration: Civitai images imported into the Library, shared across Studio and offered to
 * administrators in the Presets chip and an import's review.
 */
interface Resource {
  folder?: string;
  localName?: string;
  nameOnly?: boolean;
  profileId?: string;
  status?: string;
  weight?: number | null;
}
export interface LibraryPreset {
  id: string;
  name: string;
  prompt: string;
  negative: string;
  settings: Record<string, unknown>;
  thumbnailUrl?: string;
  type?: "image" | "video";
  resources?: Resource[];
  warnings?: string[];
}

export function compatibleSettings(preset: LibraryPreset, profile?: Profile) {
  const blockers: string[] = [];
  const warnings = [...(preset.warnings || [])];
  const resources = preset.resources || [];
  const loras = resources.filter((resource) => resource.folder === "loras");
  const settings = { ...preset.settings };
  if (!profile) blockers.push("Choose a profile first.");
  if (!preset.prompt) blockers.push("This inspiration has no prompt to apply.");
  if (profile?.ready === false) blockers.push("This profile is missing compatible model parts.");
  if (resources.some((resource) => resource.status === "unsupported"))
    blockers.push("Some source files need a compatible model or a local filename match.");
  if (loras.some((resource) => !resource.localName))
    blockers.push("Download the missing LoRAs first.");
  if (loras.some((resource) => resource.weight == null))
    blockers.push("The source did not include all LoRA weights.");
  if (profile) {
    if (loras.length && !profile.capabilities.lora)
      blockers.push("This profile does not support LoRAs.");
    if (
      loras.some(
        (resource) =>
          profile.options?.loras && !profile.options.loras.includes(resource.localName || ""),
      )
    )
      blockers.push("This profile cannot load all source LoRAs.");
    const maximum = profile.maxLoras ?? 8;
    if (loras.length > maximum) blockers.push(`This profile supports up to ${maximum} LoRAs.`);
    const checkpoint = resources.find((resource) =>
      ["checkpoints", "diffusion_models"].includes(resource.folder || ""),
    );
    if (checkpoint?.profileId && checkpoint.profileId !== profile.id)
      warnings.push("This profile differs from the source image’s.");
    for (const [field, options] of [
      ["sampler", "samplers"],
      ["scheduler", "schedulers"],
    ]) {
      const value = settings[field];
      if (
        typeof value === "string" &&
        profile.options?.[options] &&
        !profile.options[options].includes(value)
      ) {
        warnings.push(`${field} will use this profile’s default.`);
        delete settings[field];
      }
    }
    for (const field of ["cfg", "fps", "frames", "height", "steps", "width"]) {
      const value = settings[field];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const range = profile.constraints?.[field];
      if (!range) continue;
      const minimum = range.min ?? 0;
      const maximum = range.max ?? value;
      const step = range.step || 1;
      const last = Math.max(0, Math.floor((maximum - minimum) / step));
      const adjusted = Number(
        (
          minimum +
          Math.max(0, Math.min(last, Math.round((value - minimum) / step))) * step
        ).toFixed(6),
      );
      if (adjusted !== value)
        warnings.push(`${field} will use ${adjusted}, within this profile’s limits.`);
      settings[field] = adjusted;
    }
    if (
      resources.some(
        (resource) =>
          resource.folder === "vae" && (!resource.localName || !profile.capabilities.vae),
      )
    )
      blockers.push("This profile cannot use the source VAE.");
    if (resources.some((resource) => resource.folder === "text_encoders" && !resource.localName))
      blockers.push("Download the source text encoders first.");
    if (preset.negative && profile.capabilities.negativePrompt === false)
      warnings.push("This profile does not use a negative prompt.");
  }
  // The selected profile owns identity and routing; imported metadata cannot override them.
  for (const field of [
    "kind",
    "model",
    "profileId",
    "referenceAssets",
    "referenceDetails",
    "startImage",
    "startImageId",
    "workflow",
  ])
    delete settings[field];
  settings.loras = loras.map((resource) => ({
    name: resource.localName!,
    strength: resource.weight!,
    enabled: true,
  }));
  return { blockers, settings, warnings: [...new Set(warnings)] };
}

/** The Library's inspiration images (administrators only). */
export const inspirationQuery = queryOptions({
  queryKey: ["presets"],
  queryFn: () => api<{ presets: LibraryPreset[] }>("/api/presets"),
});

/**
 * The editor's input with an inspiration applied: its settings on `profile` where they fit
 * (Use Settings), else only its prompt (Use Prompt).
 */
export function inspirationInput(
  preset: LibraryPreset,
  input: GenerationInput,
  profile?: Profile,
): GenerationInput {
  const fit = compatibleSettings(preset, profile);
  if (!profile || fit.blockers.length || (preset.type || "image") !== profile.kind)
    return { ...input, prompt: preset.prompt };
  return {
    ...inputForProfile(input, profile),
    ...fit.settings,
    prompt: preset.prompt,
    negative: profile.capabilities.negativePrompt === false ? "" : preset.negative,
    referenceAssets: [],
    referenceDetails: undefined,
  };
}
