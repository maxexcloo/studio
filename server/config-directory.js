import path from "node:path";

/** The ai checkout layout, mounted read-only; runtime presets stay in Studio data. */
export const configurationDirectory = (environment = process.env) =>
  environment.STUDIO_CONFIG_DIR ? path.resolve(environment.STUDIO_CONFIG_DIR) : "";
export const configurationFile = (name, environment = process.env) => {
  const directory = configurationDirectory(environment);
  return directory ? path.join(directory, name) : "";
};
export function requireWritableConfiguration(environment = process.env) {
  if (configurationDirectory(environment))
    throw Object.assign(
      new Error(
        "Profiles, guides and catalogue definitions are managed in ai. Edit the mounted configuration there.",
      ),
      { status: 409 },
    );
}
