import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-chat-brief-"));
process.env.STUDIO_DATA_DIR = directory;
const { registerPreferenceRoutes } = await import("./preference-routes.js");
const { findDirectRoute } = await import("./domain/direct-route.ts");
const { accountPreferences } = await import("./account-preferences.js");
const { closeRuntimeDatabase, readRuntimeDocument } = await import("./persistence/runtime.ts");

test("chat briefs persist per account, patch only named fields and clear without affecting other preferences", async (t) => {
  t.after(() => {
    closeRuntimeDatabase(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const app = { get() {}, patch() {} };
  registerPreferenceRoutes(app);
  const call = (method, userId, body) =>
    findDirectRoute(app, method, "/api/chat-brief").run({ userId }, { body });
  assert.deepEqual((await call("GET", "alice")).payload.brief, {});
  assert.equal(
    (
      await call("PATCH", "alice", {
        subjects: " Portraits ",
        ethnicity: "Asian",
        age: "30–40",
        body: "tall",
        styles: "film",
        rules: "Keep the outfit",
      })
    ).status,
    200,
  );
  assert.equal((await call("PATCH", "alice", { styles: "natural light" })).status, 200);
  const saved = (await call("GET", "alice")).payload.brief;
  assert.equal(saved.subjects, "Portraits");
  assert.equal(saved.rules, "Keep the outfit");
  assert.equal(saved.styles, "natural light");
  assert.deepEqual(readRuntimeDocument(directory, "preferences:alice").chatBrief, saved);
  assert.deepEqual((await call("GET", "bob")).payload.brief, {});
  assert.equal((await call("PATCH", "alice", { invented: true })).status, 400);
  assert.equal((await call("PATCH", "alice", { age: "x".repeat(301) })).status, 400);
  assert.deepEqual((await call("GET", "alice")).payload.brief, saved);
  await call("PATCH", "alice", { subjects: "" });
  const cleared = (await call("GET", "alice")).payload.brief;
  assert.equal(cleared.subjects, undefined);
  assert.equal(cleared.rules, saved.rules);
  assert.equal(accountPreferences("alice").tileCaptions, false);
});
