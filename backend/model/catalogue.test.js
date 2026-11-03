import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point the data folder at a scratch tree before the modules read it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-model-catalogue-"));
process.env.STUDIO_DATA_DIR = path.join(scratch, "data");
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { loraCatalogue } = await import("../lora/info.js");
const { loraAllowed, modelsForAccount } = await import("./catalogue.js");

test("uncensored LoRAs need Uncensored Models, in discovery and at admission", () => {
  loraCatalogue().edit("loras/explicit.safetensors", { uncensored: true });
  loraCatalogue().edit("loras/film.safetensors", { uncensored: false });
  const names = ["explicit.safetensors", "film.safetensors", "unknown.safetensors"];
  const models = {
    loras: names,
    profiles: [{ id: "local", capabilities: { lora: true }, options: { loras: names } }],
  };
  const member = (uncensoredModels) => ({
    authenticated: true,
    role: "user",
    allModels: true,
    generationProfiles: [],
    features: { loras: true, uncensoredModels },
  });
  const shown = (access) => modelsForAccount(models, { studioAccount: access });

  const limited = shown(member(false));
  assert.deepEqual(limited.loras, ["film.safetensors", "unknown.safetensors"]);
  assert.deepEqual(limited.profiles[0].options.loras, limited.loras);
  assert.equal(loraAllowed(member(false))("explicit.safetensors"), false);

  assert.deepEqual(shown(member(true)).loras, names);
  // An administrator who turned Uncensored Models off for their own use sees what a member would.
  assert.deepEqual(shown({ ...member(true), role: "administrator" }).loras, names);
  assert.deepEqual(shown({ ...member(false), role: "administrator" }).loras, limited.loras);
  assert.equal(loraAllowed(undefined)("explicit.safetensors"), true);
});
