/** The backends one profile can run on, by name; a combined profile keeps each one's graph and settings in `studio.backends`. */
export const profileBackendLabels: Readonly<Record<string, string>> = Object.freeze({
  comfyui: "ComfyUI",
  radiance: "Radiance",
});

/** What a combined profile shares across its backends; any other field in `studio.backends.<id>` replaces the shared one. */
export const sharedProfileFields: readonly string[] = Object.freeze([
  "id",
  "name",
  "kind",
  "family",
  "uncensored",
  "prompting",
]);

/** A profile name's "·" segments without its backend's, so "Krea 2 · ComfyUI · Fast" keeps "Krea 2" and "Fast". */
export const profileNameParts = (name: string) =>
  String(name)
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part && !Object.hasOwn(profileBackendLabels, part.toLowerCase()));
