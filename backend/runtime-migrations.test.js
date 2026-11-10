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
  assert.deepEqual(await post({}), { code: 200, body: { ok: true, apply: false, steps: {} } });
  assert.deepEqual(await post({ apply: true }), {
    code: 200,
    body: { ok: true, apply: true, steps: {} },
  });
  assert.deepEqual(lines, [
    "[migrations] Dry run: no steps pending",
    "[migrations] Apply: no steps pending",
  ]);
  assert.deepEqual(fs.readdirSync(dataDir), [], "nothing pending writes nothing");
});
