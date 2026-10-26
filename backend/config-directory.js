import path from "node:path";

/** Read-only ai seed and deployment metadata; editable definitions live in Studio data. */
export const configurationDirectory = (environment = process.env) =>
  environment.STUDIO_CONFIG_DIR ? path.resolve(environment.STUDIO_CONFIG_DIR) : "";
export const configurationFile = (name, environment = process.env) => {
  const directory = configurationDirectory(environment);
  return directory ? path.join(directory, name) : "";
};
