import type { GenerationInput } from "../../types";

export interface Preset {
  id: string;
  title: string;
  input: GenerationInput;
  savedAt?: string;
  /** The parts of the draft it holds, when only some; one saved without holds them all. */
  parts?: PresetPart[];
  /** The model family its LoRAs were chosen for, which the LoRA picker lists it under. */
  family?: string;
}
/** The parts of a draft a preset may hold, by their input fields; Model & Settings has the rest. */
export const presetParts = [
  { value: "prompt", label: "Prompt", noun: "prompt", keys: ["prompt", "cardParts"] },
  { value: "negative", label: "Negative", noun: "negative prompt", keys: ["negative"] },
  { value: "settings", label: "Model & Settings", noun: "model and settings", keys: [] },
  {
    value: "size",
    label: "Size",
    noun: "size",
    keys: ["width", "height", "resolution", "resolutionTier", "tiledDecode"],
  },
  { value: "loras", label: "LoRAs", noun: "LoRAs", keys: ["loras"] },
  {
    value: "references",
    label: "References",
    noun: "references",
    keys: ["referenceAssets", "referenceDetails"],
  },
] as const;
export type PresetPart = (typeof presetParts)[number]["value"];
const partOf = (key: string): PresetPart =>
  presetParts.find((part) => (part.keys as readonly string[]).includes(key))?.value ?? "settings";
/** The input's fields in `parts`, or all of it. */
export const presetInput = (input: GenerationInput, parts?: PresetPart[]) =>
  (parts
    ? Object.fromEntries(Object.entries(input).filter(([key]) => parts.includes(partOf(key))))
    : input) as GenerationInput;
/** What a preset holds, by its parts' names, or those it leaves out when it holds most. */
export const presetHolds = ({ parts }: Preset) => {
  if (!parts) return "Everything";
  const [held, left] = [true, false].map((holds) =>
    presetParts.filter((part) => parts.includes(part.value) === holds).map((part) => part.label),
  );
  return left.length < held.length ? `All but ${left.join(" · ")}` : held.join(" · ");
};
/** Asks before a preset replaces the draft's parts it holds. */
export function replaceMessage(preset: Preset) {
  if (!preset.parts) return "Replace the current prompt and settings with this preset?";
  const nouns = presetParts
    .filter((part) => preset.parts?.includes(part.value))
    .map((part) => part.noun);
  const list = nouns.length > 1 ? `${nouns.slice(0, -1).join(", ")} and ${nouns.at(-1)}` : nouns[0];
  return `Replace the current ${list} with this preset? The rest stays as it is.`;
}
/** A value as JSON with its keys sorted, so equal drafts compare equal however they were built. */
const stable = (value: unknown) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
/** Whether the draft differs from the preset in any part the preset holds. */
export const presetEdited = (preset: Preset, input: GenerationInput) => {
  const draft = presetInput(input, preset.parts) as Record<string, unknown>;
  const saved = preset.input as Record<string, unknown>;
  return Object.keys(saved).some((key) => stable(draft[key]) !== stable(saved[key]));
};
/** The preset an editor last loaded or saved. */
export interface PresetSelection {
  presetId?: string;
  presetTitle?: string;
}

/** The exact input a partial preset overlays; a full preset replaces it. */
export function loadPresetInput(preset: Preset, current: GenerationInput): GenerationInput {
  return preset.parts
    ? {
        ...current,
        ...(preset.parts.includes("prompt") ? { cardParts: undefined } : {}),
        ...preset.input,
      }
    : preset.input;
}

/** Confirm only when loading changes work that differs from its saved/default baseline. */
export function presetReplacesUnsaved(
  current: GenerationInput,
  loaded: GenerationInput,
  defaults: GenerationInput,
  selected?: Preset,
) {
  const baseline = {
    ...defaults,
    ...(selected ? presetInput(selected.input, selected.parts) : {}),
  };
  return Object.keys(current).some(
    (key) =>
      // Asset IDs, roles and strengths are in referenceAssets; referenceDetails is display metadata.
      key !== "referenceDetails" &&
      key !== "profileName" &&
      stable(current[key]) !== stable(loaded[key]) &&
      stable(current[key]) !== stable(baseline[key]),
  );
}
