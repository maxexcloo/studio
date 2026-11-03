import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { uncensoredMarker } from "./uncensored-marker.js";

test("the old nsfw marker becomes uncensored in profiles, the catalogue and groups, once", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-uncensored-"));
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(dataDir, file)), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, file),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const read = (file) => fs.readFileSync(path.join(dataDir, file), "utf8");
  write(
    "workflows/marked.json",
    '{\n  "studio": { "id": "marked", "nsfw": true },\n  "1": { "inputs": {} }\n}\n',
  );
  write("workflows/plain.json", '{ "studio": { "id": "plain" } }\n');
  write("library/catalogue.json", {
    entries: { "loras/a.safetensors": { nsfw: false } },
    edits: {
      "loras/a.safetensors": { fields: { nsfw: true }, history: [{ patch: { nsfw: null } }] },
    },
  });
  write("library/imports/one.json", { nsfw: true, draft: { nsfw: null } });
  write("accounts.json", {
    profiles: {
      user: { features: { nsfwModels: false } },
      open: { features: { nsfwModels: true } },
    },
  });

  const plan = uncensoredMarker(dataDir);
  assert.deepEqual(
    [plan.profiles, plan.files, plan.accessProfiles],
    [["marked"], { "library/catalogue.json": 3, "library/imports/one.json": 2 }, ["user", "open"]],
  );
  assert.match(read("workflows/marked.json"), /"nsfw"/, "a dry run writes nothing");

  uncensoredMarker(dataDir, { apply: true });
  assert.equal(
    read("workflows/marked.json"),
    '{\n  "studio": { "id": "marked", "uncensored": true },\n  "1": { "inputs": {} }\n}\n',
  );
  assert.ok(fs.existsSync(path.join(dataDir, "history", "profiles", "marked")), "a new version");
  assert.deepEqual(JSON.parse(read("library/imports/one.json")), {
    uncensored: true,
    draft: { uncensored: null },
  });
  assert.deepEqual(JSON.parse(read("accounts.json")).profiles.open.features, {
    uncensoredModels: true,
  });
  const again = uncensoredMarker(dataDir);
  assert.deepEqual([again.profiles, again.files, again.accessProfiles], [[], {}, []]);
});
