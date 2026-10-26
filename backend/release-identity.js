import fs from "node:fs";

export const releaseIdentity = JSON.parse(
  fs.readFileSync(new URL("./release-identity.json", import.meta.url), "utf8"),
);
export const repositoryUrl = `https://github.com/${releaseIdentity.repository}`;
