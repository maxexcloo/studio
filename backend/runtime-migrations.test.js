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

  const workflows = path.join(dataDir, "workflows");
  fs.mkdirSync(workflows);
  const file = path.join(workflows, "image-krea2.json");
  const node = (model) => ({ 1: { class_type: "RadianceImageGenerate", inputs: { model } } });
  fs.writeFileSync(
    file,
    JSON.stringify({
      graph: node("krea-2-turbo-fp8.rad"),
      studio: { id: "image-krea2", defaults: { model: "krea-2-turbo-fp8.rad" } },
    }),
  );
  fs.writeFileSync(
    path.join(workflows, "image-other.json"),
    JSON.stringify({ graph: node("x.rad") }),
  );
  const plan = {
    applied: false,
    profiles: [{ name: "image-krea2.json", changes: ["krea-2-turbo-fp8.rad → krea-2-turbo-iq8r"] }],
    unknown: ["image-other.json: x.rad"],
  };

  assert.deepEqual(await post({ apply: true }, "user"), { code: 403, body: refusal.payload });
  const steps = (applied, radiance = plan) => ({
    dreamAnimationStars: { applied, stars: 0, owners: {} },
    mcpOwnership: { applied, document: false, rows: {}, conflicts: [] },
    galleryRatings: { applied, likes: 0, unstarred: 0, dislikes: 0, signals: 0 },
    radianceModels: { ...radiance, applied },
    characterGenerated: { applied, characters: 0, cards: [] },
    legacyShapes: { applied, arms: 0, notes: 0, editsFile: false },
  });
  assert.deepEqual(await post({}), {
    code: 200,
    body: { ok: true, apply: false, steps: steps(false) },
  });
  assert.deepEqual(await post({ apply: true }), {
    code: 200,
    body: { ok: true, apply: true, steps: steps(true) },
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    graph: node("krea-2-turbo-iq8r"),
    studio: { id: "image-krea2", defaults: { model: "krea-2-turbo-iq8r" } },
  });
  const again = await post({ apply: true });
  assert.deepEqual(again.body.steps.radianceModels.profiles, [], "a second run finds nothing");
  assert.deepEqual(lines, [
    "[migrations] Dry run: dreamAnimationStars: 0 nothing to do; mcpOwnership: 0 nothing to do; galleryRatings: 0 nothing to do; radianceModels: 1 planned; characterGenerated: 0 nothing to do; legacyShapes: 0 nothing to do",
    "[migrations] Apply: dreamAnimationStars: 0 nothing to do; mcpOwnership: 0 nothing to do; galleryRatings: 0 nothing to do; radianceModels: 1 applied; characterGenerated: 0 nothing to do; legacyShapes: 0 nothing to do",
    "[migrations] Apply: dreamAnimationStars: 0 nothing to do; mcpOwnership: 0 nothing to do; galleryRatings: 0 nothing to do; radianceModels: 0 nothing to do; characterGenerated: 0 nothing to do; legacyShapes: 0 nothing to do",
  ]);
});
