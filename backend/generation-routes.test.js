import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "studio-data-"));
process.env.STUDIO_DEMO = "1";
process.env.STUDIO_WORKERS = "[]";
const { registerGenerationRoutes } = await import("./generation-routes.js");

const granted = { id: "custom:granted", kind: "image", workflow: "custom:granted" };
const other = { id: "custom:other", kind: "image", workflow: "custom:other", uncensored: true };
for (const profile of [granted, other]) profile.model = profile.id;
const routes = registerGenerationRoutes(
  { post() {} },
  {
    loadComfyContext: async () => {
      throw new Error("No ComfyUI in this fixture.");
    },
    mediaModels: async () => ({ models: { profiles: [granted, other] } }),
    comfyDownMessage: (message) => message,
  },
);
const artist = {
  authenticated: true,
  userId: "artist",
  role: "user",
  generationProfiles: [granted.id],
  features: { uncensoredModels: false },
};
const request = (input) => ({ prompt: "A lighthouse", kind: "image", ...input });

test("an ordinary account runs only the profile it is granted", async () => {
  for (const input of [
    { profileId: granted.id, workflow: other.workflow, model: granted.model },
    { profileId: granted.id, workflow: granted.workflow, model: other.model },
  ]) {
    const result = await routes.validateInput(request(input), artist);
    assert.equal(result.status, 400, JSON.stringify(input));
  }
  const input = request({ profileId: granted.id, workflow: granted.workflow, model: granted.id });
  assert.equal((await routes.validateInput(input, artist)).status, 200);
  const foreign = request({ ...input, modelName: "uncensored-checkpoint.safetensors" });
  assert.equal((await routes.validateInput(foreign, artist)).status, 200);
  assert.equal(foreign.modelName, undefined, "the profile's own checkpoint runs");
  const administrator = { authenticated: true, userId: "admin", role: "administrator" };
  const chosen = request({ ...input, modelName: "uncensored-checkpoint.safetensors" });
  assert.equal((await routes.validateInput(chosen, administrator)).status, 200);
  assert.equal(chosen.modelName, "uncensored-checkpoint.safetensors");
});
