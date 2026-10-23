// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How faithfully a Library import can be recreated (design §2.4): Exact, Close or Partial, with
 * the reasons and the prompt fields that were not recorded. Pure: no files, no network.
 *
 *   Exact    every file installed and verified by checksum, the base model runs on a profile of
 *            its family, nothing substituted or approximated, and the prompt complete.
 *   Close    the prompt complete, but a substitute, a match by name or size only, an approximate
 *            sampler or schedule (or the workflow default), or extra processing Studio can't redo.
 *   Partial  the base model missing or unsupported, a file missing or unavailable, the prompt
 *            incomplete, or the image described by AI.
 *
 * Any missing prompt field caps the grade at Partial and is named in the reasons.
 */

/** The prompt fields Exact and Close need, in the order they are reported. */
export const promptFields = Object.freeze([
  ["prompt", "No prompt recorded"],
  ["seed", "No seed recorded"],
  ["sampler", "No sampler recorded"],
  ["steps", "No steps recorded"],
  ["cfg", "No CFG recorded"],
  ["width", "No width recorded"],
  ["height", "No height recorded"],
  ["negative", "No negative prompt recorded"],
]);

const present = (value) => value !== undefined && value !== null && String(value).trim() !== "";
const unavailableWords = {
  paid: "is paid on Civitai",
  "early-access": "is in early access on Civitai",
  licence: "can’t be downloaded under its licence",
  "no-checksum": "has no published checksum",
};

/**
 * The prompt fields a recipe lacks. `recipe` holds what the source recorded; `cfgUsed` (default
 * true) says whether the profile takes CFG; `negativeUsed` whether the source used a negative.
 */
export function missingPromptFields(recipe = {}) {
  const missing = [];
  for (const [field] of promptFields) {
    if (field === "cfg" && recipe.cfgUsed === false) continue;
    if (field === "negative" && !recipe.negativeUsed) continue;
    if (!present(recipe[field])) missing.push(field);
  }
  return missing;
}

const label = (resource) => resource.name || resource.title || resource.file || "A file";

/**
 * The grade for one import.
 *   resources:  [{name, role, status, unverified?, nameOnly?, substitute?, unavailable?, optional?}]
 *               status is installed | missing | downloading | conflict | unavailable | unsupported | substitute
 *   recipe:     the recorded prompt fields, or null when the import is a model file (no prompt to grade)
 *   described:  the prompt was written by AI from the picture
 *   approximate: reasons a sampler, schedule or setting is approximated or left to the workflow default
 *   extraProcessing: the source recorded processing Studio can't reproduce (hires, ControlNet, ADetailer)
 *   baseModel:  for a recipe: {required, installed, profile} for its checkpoint; omitted for model files
 */
export function gradeImport({
  resources = [],
  recipe = null,
  described = false,
  approximate = [],
  extraProcessing = false,
  baseModel = null,
} = {}) {
  const partial = [];
  const close = [];
  const required = resources.filter((resource) => !resource.optional);
  const graded = required.length
    ? required
    : resources.filter(
        (resource) => resource.status === "installed" || resource.status === "substitute",
      );
  if (described) partial.push("Described by AI; no recorded settings");
  if (!resources.length && !recipe) partial.push("No model file was found");
  if (resources.length && !graded.length) partial.push("No file chosen yet");
  if (baseModel) {
    if (!baseModel.required) partial.push("No base model recorded");
    else if (!baseModel.installed) partial.push("The base model isn’t installed");
    else if (!baseModel.profile) partial.push("No profile runs the base model");
  }
  for (const resource of graded) {
    const name = label(resource);
    if (resource.status === "installed") {
      if (resource.nameOnly) close.push(`${name} matched by filename only`);
      else if (resource.unverified)
        close.push(`${name} matched by name and size, not yet verified`);
    } else if (resource.status === "substitute")
      close.push(
        `${name} uses a substitute${resource.substitute?.reason ? `: ${resource.substitute.reason}` : ""}`,
      );
    else if (resource.status === "unavailable")
      partial.push(`${name} ${unavailableWords[resource.unavailable?.reason] || "is unavailable"}`);
    else if (resource.status === "unsupported") partial.push(`${name} isn’t supported here`);
    else if (resource.status === "conflict")
      partial.push(`A different file already uses the name of ${name}`);
    else if (resource.status === "downloading") partial.push(`${name} is downloading`);
    else partial.push(`${name} isn’t installed`);
  }
  const missingFields = recipe ? missingPromptFields(recipe) : [];
  for (const field of missingFields) partial.push(promptFields.find(([name]) => name === field)[1]);
  for (const reason of approximate) close.push(reason);
  if (extraProcessing) close.push("Extra processing was recorded that Studio can’t reproduce");
  if (partial.length) return { value: "partial", reasons: [...partial, ...close], missingFields };
  if (close.length) return { value: "close", reasons: close, missingFields };
  return {
    value: "exact",
    reasons: [
      recipe
        ? "Every file is installed and verified, and the prompt and settings are complete"
        : "Installed and verified by checksum",
    ],
    missingFields,
  };
}

const modelFolders = new Set(["checkpoints", "diffusion_models"]);

/** The grade for a saved Civitai image (a preset after matchResources). */
export function presetGrade(preset = {}, { cfgUsed = true } = {}) {
  const warnings = Array.isArray(preset.warnings) ? preset.warnings : [];
  const settings = preset.settings || {};
  const metadata =
    preset.sourceMetadata && typeof preset.sourceMetadata === "object" ? preset.sourceMetadata : {};
  const resources = (preset.resources || []).map((resource) => ({
    name: resource.name,
    role: modelFolders.has(resource.folder) ? "checkpoint" : resource.folder,
    unverified: resource.unverified,
    nameOnly: resource.nameOnly,
    status:
      resource.status === "installed"
        ? "installed"
        : resource.status === "conflict"
          ? "conflict"
          : resource.unavailable
            ? "unavailable"
            : resource.status === "unsupported"
              ? "unsupported"
              : "missing",
    ...(resource.unavailable ? { unavailable: resource.unavailable } : {}),
  }));
  const checkpoints = (preset.resources || []).filter((resource) =>
    modelFolders.has(resource.folder),
  );
  const installed = checkpoints.find((resource) => resource.status === "installed");
  const approximate = warnings
    .filter((warning) => /needs a manual choice|default will be used/i.test(warning))
    .map((warning) => warning.replace(/\.$/, ""));
  return gradeImport({
    resources,
    recipe: {
      prompt: preset.prompt,
      negative: preset.negative,
      negativeUsed: present(metadata.negativePrompt),
      cfgUsed,
      ...settings,
    },
    approximate,
    extraProcessing: warnings.some((warning) =>
      /additional processing was recorded/i.test(warning),
    ),
    baseModel: {
      required: checkpoints.length > 0,
      installed: Boolean(installed),
      profile: Boolean(installed?.profileId),
    },
  });
}
