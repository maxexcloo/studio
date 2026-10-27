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
  "nsfw",
  "prompting",
]);
