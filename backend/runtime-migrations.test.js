import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { closeRuntimeDatabase } from "./persistence/runtime.ts";
import { registerMigrationRoutes } from "./runtime-migrations.js";

test("the migrations route answers administrators with every step's plan, and logs each run", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-runtime-migrations-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const routes = {};
  const lines = [];
  const refusal = { status: 403, payload: { ok: false, error: "Administrators only." } };
  registerMigrationRoutes(
    { post: (route, handler) => (routes[route] = handler) },
    {
      dataDir,
      adminRefusal: (account) => (account?.role === "administrator" ? null : refusal),
      log: { info: (line) => lines.push(line) },
    },
  );
  const post = async (body, role = "administrator") => {
    const res = { status: (code) => ((res.code = code), res), json: (value) => (res.body = value) };
    await routes["/api/maintenance/migrations"]({ studioAccount: { role }, body }, res);
    return { code: res.code, body: res.body };
  };

  assert.deepEqual(await post({ apply: true }, "user"), { code: 403, body: refusal.payload });
  const steps = (applied) => ({
    dreamAnimationStars: { applied, stars: 0, owners: {} },
    mcpOwnership: { applied, document: false, rows: {}, conflicts: [] },
    galleryRatings: { applied, likes: 0, unstarred: 0, dislikes: 0, signals: 0 },
    characterGenerated: { applied, characters: 0, cards: [] },
    legacyShapes: { applied, arms: 0, notes: 0, editsFile: false },
    loraStacks: { applied, accounts: 0 },
    dreamDefaultChoices: { applied, settings: 0, accounts: 0 },
    tasteDislikes: { applied, accounts: 0 },
    spicyPrompts: { applied, accounts: 0 },
    chatBriefFavourites: { applied, accounts: 0, dropped: 0 },
    imageSizeDefaults: { applied, profiles: [] },
    whereWorkRuns: { applied, accounts: 0 },
    localTextAuto: { applied, accounts: 0 },
    profileAliases: { applied, aliases: 0, records: 0, renames: {}, unmatched: {} },
    flux2Records: {
      applied,
      records: 0,
      modelFile: 0,
      profileName: 0,
      textEncoder: 0,
      unresolved: 0,
    },
    // Needs Studio stopped, so the running server only plans it.
    runtimeSettings: { applied: false, settings: 0 },
  });
  assert.deepEqual(await post({}), {
    code: 200,
    body: { ok: true, apply: false, steps: steps(false) },
  });
  assert.deepEqual(await post({ apply: true }), {
    code: 200,
    body: { ok: true, apply: true, steps: steps(true) },
  });
  assert.deepEqual(lines, [
    "[migrations] Dry run: dreamAnimationStars: 0 nothing to do; mcpOwnership: 0 nothing to do; galleryRatings: 0 nothing to do; characterGenerated: 0 nothing to do; legacyShapes: 0 nothing to do; loraStacks: 0 nothing to do; dreamDefaultChoices: 0 nothing to do; tasteDislikes: 0 nothing to do; spicyPrompts: 0 nothing to do; chatBriefFavourites: 0 nothing to do; imageSizeDefaults: 0 nothing to do; whereWorkRuns: 0 nothing to do; localTextAuto: 0 nothing to do; profileAliases: 0 nothing to do; flux2Records: 0 nothing to do; runtimeSettings: 0 nothing to do",
    "[migrations] Apply: dreamAnimationStars: 0 nothing to do; mcpOwnership: 0 nothing to do; galleryRatings: 0 nothing to do; characterGenerated: 0 nothing to do; legacyShapes: 0 nothing to do; loraStacks: 0 nothing to do; dreamDefaultChoices: 0 nothing to do; tasteDislikes: 0 nothing to do; spicyPrompts: 0 nothing to do; chatBriefFavourites: 0 nothing to do; imageSizeDefaults: 0 nothing to do; whereWorkRuns: 0 nothing to do; localTextAuto: 0 nothing to do; profileAliases: 0 nothing to do; flux2Records: 0 nothing to do; runtimeSettings: 0 nothing to do",
  ]);
});
