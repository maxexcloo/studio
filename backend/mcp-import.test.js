import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { importMcpOwnership, mcpImportSupported } from "./mcp-import.js";
import { McpMedia } from "./mcp-media.js";

const environment = {
  STUDIO_MCP_API_KEY: "test-provider-key",
  MCP_SIGNING_KEY: "test-signing-key",
};
const options = { skip: !mcpImportSupported() };
async function fixture(t, rows) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mcp-import-"));
  const database = path.join(root, "jobs.sqlite");
  const dataDir = path.join(root, "studio");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(database);
  db.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY, studio TEXT, owner TEXT)");
  const insert = db.prepare("INSERT INTO jobs VALUES (?, ?, ?)");
  for (const row of rows) insert.run(...row);
  db.close();
  const before = fs.readFileSync(database);
  t.after(() => {
    try {
      assert.deepEqual(
        fs.readFileSync(database),
        before,
        "legacy database stays byte-for-byte unchanged",
      );
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });
  return { database, dataDir, environment };
}
const read = (f) => JSON.parse(fs.readFileSync(path.join(f.dataDir, "mcp-ownership.json"), "utf8"));
const native = (f) =>
  new McpMedia({
    dataDir: f.dataDir,
    baseUrl: "http://127.0.0.1:8787",
    publicUrl: "http://127.0.0.1:8787",
    signingKey: environment.MCP_SIGNING_KEY,
  });

test(
  "legacy ownership import selects one studio and preserves forwarded and provider identities",
  options,
  async (t) => {
    const f = await fixture(t, [
      ["primary-user", "primary", "openwebui:alice"],
      ["primary-provider", "primary", "litellm:heiss"],
      ["x-user", "secondary", "openwebui:bob"],
      ["x-provider", "secondary", "litellm:heiss-secondary"],
    ]);
    assert.deepEqual(await importMcpOwnership({ ...f, studio: "primary" }), {
      imported: 2,
      unchanged: 0,
      studio: "primary",
    });
    const media = native(f);
    media.own(media.owner("alice", environment.STUDIO_MCP_API_KEY), "primary-user");
    media.own(media.owner("", environment.STUDIO_MCP_API_KEY), "primary-provider");
    assert.throws(() =>
      media.own(media.owner("bob", environment.STUDIO_MCP_API_KEY), "primary-user"),
    );
    assert.equal(Object.hasOwn(read(f).jobs, "x-user"), false);
    if (process.platform !== "win32")
      assert.equal(fs.statSync(path.join(f.dataDir, "mcp-ownership.json")).mode & 0o777, 0o600);
    const x = {
      ...f,
      dataDir: path.join(f.dataDir, "x"),
      environment: { ...environment, STUDIO_MCP_API_KEY: "test-x-provider" },
    };
    assert.equal((await importMcpOwnership({ ...x, studio: "secondary" })).imported, 2);
    const hash = crypto
      .createHmac("sha256", environment.MCP_SIGNING_KEY)
      .update("provider:test-x-provider")
      .digest("hex");
    assert.equal(read(x).jobs["x-provider"], hash);
    assert.equal(Object.hasOwn(read(x).jobs, "primary-user"), false);
  },
);

test(
  "ownership import merges idempotently without replacing existing jobs, references or metadata",
  options,
  async (t) => {
    const f = await fixture(t, [["legacy", "primary", "openwebui:alice"]]);
    const media = native(f);
    media.state.jobs.existing = media.owner("bob", environment.STUDIO_MCP_API_KEY);
    media.state.assets.reference = ["existing-reference-owner"];
    media.state.extra = "retained";
    media.save();
    const before = read(f);
    assert.equal((await importMcpOwnership({ ...f, studio: "primary" })).imported, 1);
    const merged = read(f);
    assert.equal(merged.jobs.existing, before.jobs.existing);
    assert.deepEqual(merged.assets, before.assets);
    assert.equal(merged.signingKey, before.signingKey);
    assert.equal(merged.extra, before.extra);
    const exact = fs.readFileSync(path.join(f.dataDir, "mcp-ownership.json"));
    const backup = fs.readFileSync(path.join(f.dataDir, "mcp-ownership.json.bak"));
    assert.deepEqual(await importMcpOwnership({ ...f, studio: "primary" }), {
      imported: 0,
      unchanged: 1,
      studio: "primary",
    });
    assert.deepEqual(fs.readFileSync(path.join(f.dataDir, "mcp-ownership.json")), exact);
    assert.deepEqual(fs.readFileSync(path.join(f.dataDir, "mcp-ownership.json.bak")), backup);
  },
);

test(
  "conflicting and unknown owners reject the entire import before writing destination state",
  options,
  async (t) => {
    const f = await fixture(t, [
      ["new-first", "primary", "openwebui:alice"],
      ["conflict", "primary", "openwebui:alice"],
    ]);
    const media = native(f);
    media.state.jobs.conflict = media.owner("bob", environment.STUDIO_MCP_API_KEY);
    media.save();
    const file = path.join(f.dataDir, "mcp-ownership.json");
    const before = fs.readFileSync(file);
    await assert.rejects(importMcpOwnership({ ...f, studio: "primary" }), /conflicting ownership/);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(Object.hasOwn(read(f).jobs, "new-first"), false);
    const unknown = await fixture(t, [
      ["new-first", "primary", "openwebui:alice"],
      ["unknown", "primary", "litellm:heiss-secondary"],
    ]);
    await assert.rejects(
      importMcpOwnership({ ...unknown, studio: "primary" }),
      /unknown legacy owner/,
    );
    assert.equal(fs.existsSync(unknown.dataDir), false);
  },
);

test(
  "import preflight rejects absent credentials, invalid studios and corrupt destinations without changes",
  options,
  async (t) => {
    const f = await fixture(t, [["primary", "primary", "litellm:heiss"]]);
    for (const config of [
      { ...f, studio: "both" },
      { ...f, studio: "primary", environment: {} },
      { ...f, studio: "primary", environment: { MCP_SIGNING_KEY: "test" } },
    ])
      await assert.rejects(importMcpOwnership(config));
    assert.equal(fs.existsSync(f.dataDir), false);
    fs.mkdirSync(f.dataDir);
    const file = path.join(f.dataDir, "mcp-ownership.json");
    fs.writeFileSync(file, "invalid JSON");
    await assert.rejects(importMcpOwnership({ ...f, studio: "primary" }), /unreadable or invalid/);
    assert.equal(fs.readFileSync(file, "utf8"), "invalid JSON");
    assert.equal(fs.existsSync(file + ".bak"), false);
  },
);

test(
  "import CLI accepts only explicit paths/studio and never prints credentials or record identities",
  options,
  async (t) => {
    const f = await fixture(t, [["private-job-id", "primary", "openwebui:private-user"]]);
    const result = spawnSync(
      process.execPath,
      [
        "backend/mcp-import.js",
        "--data-dir",
        f.dataDir,
        "--database",
        f.database,
        "--studio",
        "primary",
      ],
      { encoding: "utf8", env: { ...process.env, ...environment } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Imported 1 job ownership records/);
    for (const value of [...Object.values(environment), "private-job-id", "private-user"])
      assert.equal((result.stdout + result.stderr).includes(value), false);
    const bad = spawnSync(
      process.execPath,
      ["backend/mcp-import.js", "--secret", "private-secret-value"],
      { encoding: "utf8" },
    );
    assert.equal(bad.status, 1);
    assert.equal((bad.stdout + bad.stderr).includes("private-secret-value"), false);
  },
);
