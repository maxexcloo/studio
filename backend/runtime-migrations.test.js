import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { registerMigrationRoutes } from "./runtime-migrations.js";

test("the migrations route answers administrators with every step's plan, and logs each run", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-runtime-migrations-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
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
  const dry = await post({});
  assert.equal(dry.code, 200);
  assert.deepEqual(Object.keys(dry.body.steps), [
    "chatRecords",
    "pruneBackups",
    "missingComfyOutputs",
    "comparisonSets",
  ]);
  assert.deepEqual(await post({ apply: true }), {
    code: 200,
    body: { ok: true, apply: true, steps: dry.body.steps },
  });
  assert.deepEqual(lines, [
    "[migrations] Dry run: chatRecords: 0 nothing to do; pruneBackups: 0 nothing to do; missingComfyOutputs: 0 nothing to do; comparisonSets: 0 nothing to do",
    "[migrations] Apply: chatRecords: 0 nothing to do; pruneBackups: 0 nothing to do; missingComfyOutputs: 0 nothing to do; comparisonSets: 0 nothing to do",
  ]);
  assert.deepEqual(fs.readdirSync(dataDir), [], "nothing pending writes nothing");
});
