import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { mcpOwnershipRows } from "./mcp-ownership-rows.js";
import { McpMedia } from "./mcp/media.js";
import {
  closeRuntimeDatabase,
  savedDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("mcpOwnership moves MCP's records into rows, and its links, numbers and results keep working", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mcp-ownership-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const audience = "https://studio.example.test";
  writeRuntimeDocument(dataDir, "mcp-ownership", {
    version: 1,
    signingKey: "old-signing-key",
    jobs: { "job-a": "owner-1", "job-b": "owner-1", "job-c": "owner-2" },
    assets: { "asset-1": "owner-1", "asset-2": ["owner-1", "owner-2"] },
    refs: {
      scope1: {
        next: 3,
        at: 1,
        jobs: { 1: "job-a", 2: "job-b" },
        offer: { comparison: "cmp-1", jobs: ["job-a", "job-b"] },
      },
    },
    numbers: { "job-a": [12], "job-b": [null, 14] },
    links: {
      Aaaaaaaaa1: { audience, owner: "owner-1", jobId: "job-a", index: 0 },
      Aaaaaaaaa2: { audience, owner: "owner-1", jobId: "job-a", page: true },
      Aaaaaaaaa3: { audience, owner: "owner-1", scope: "scope1", all: true },
    },
    prompts: { "job-a": { prompt: "a lighthouse" } },
    uploads: { "upload-link:abcdefghijklmnop": "asset-1" },
  });
  const options = { dataDir, publicUrl: audience, domainRequest: async () => ({ status: 404 }) };
  assert.throws(() => new McpMedia(options), /apply migrate-runtime's mcpOwnership step/);
  const waiting = new McpMedia({ ...options, signingKey: "old-signing-key" });
  assert.throws(() => waiting.claims("Aaaaaaaaa1"), /moving its MCP records/);

  const plan = mcpOwnershipRows(dataDir);
  assert.deepEqual(plan, {
    applied: false,
    document: true,
    rows: { jobs: 3, assets: 3, refs: 2, offers: 1, numbers: 2, links: 3, prompts: 1, uploads: 1 },
    conflicts: [],
  });
  assert.equal(mcpOwnershipRows(dataDir, { apply: true }).applied, true);
  assert.equal(savedDocument(dataDir, "mcp-ownership"), undefined);
  assert.deepEqual(mcpOwnershipRows(dataDir), {
    applied: false,
    document: false,
    rows: {},
    conflicts: [],
  });

  const media = new McpMedia(options);
  assert.equal(media.key, "old-signing-key");
  assert.deepEqual(waiting.claims("Aaaaaaaaa1"), { owner: "owner-1", jobId: "job-a", index: 0 });
  assert.equal(media.shortId("owner-1", "job-a", 0), "Aaaaaaaaa1");
  assert.equal(media.shortId("owner-1", "job-a"), "Aaaaaaaaa2");
  assert.equal(media.allUrl("owner-1", "scope1"), `${audience}/mcp/results/Aaaaaaaaa3`);
  assert.deepEqual(await media.resolve("owner-1", "scope1", "#14"), { jobId: "job-b", index: 1 });
  assert.equal((await media.resolve("owner-1", "scope1", "B")).jobId, "job-b");
  assert.equal(media.reference("owner-1", "scope1", "job-c"), 3);
  assert.deepEqual(media.promptRecord("job-a"), { prompt: "a lighthouse" });
  assert.equal(media.referenceId("upload-link:abcdefghijklmnop"), "asset-1");
  assert.doesNotThrow(() => media.own("owner-2", "asset-2", "assets"));
  assert.throws(() => media.own("owner-2", "job-a"), /submitted by this account/);
});
