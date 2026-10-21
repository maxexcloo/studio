import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { McpMedia } from "./mcp-media.js";

test("result links are sealed, reveal no account or job, and earlier signed links still open", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-result-links-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const media = new McpMedia({ dataDir, baseUrl: "http://127.0.0.1:1", publicUrl: "https://studio.example.test", signingKey: "fixture-signing-key" });
  media.state.jobs["job-secret-42"] = "account-private-7";
  const token = media.token("account-private-7", "job-secret-42", 0);
  assert.match(token, /^v2\./);
  for (const part of token.split(".").slice(1)) {
    const decoded = Buffer.from(part, "base64url").toString("latin1");
    assert.equal(decoded.includes("account-private-7") || decoded.includes("job-secret-42"), false);
  }
  assert.deepEqual(media.claims(token), { audience: "https://studio.example.test", owner: "account-private-7", jobId: "job-secret-42", index: 0 });
  assert.notEqual(media.token("account-private-7", "job-secret-42", 0), token, "each link has its own nonce");

  const legacyPayload = Buffer.from(JSON.stringify({ audience: "https://studio.example.test", owner: "account-private-7", jobId: "job-secret-42", index: 0 })).toString("base64url");
  const legacy = `${legacyPayload}.${crypto.createHmac("sha256", "fixture-signing-key").update(legacyPayload).digest("hex")}`;
  assert.equal(media.claims(legacy).jobId, "job-secret-42");

  const other = new McpMedia({ dataDir: fs.mkdtempSync(path.join(dataDir, "other-")), baseUrl: "http://127.0.0.1:1", publicUrl: "https://studio.example.test", signingKey: "another-key" });
  other.state.jobs["job-secret-42"] = "account-private-7";
  assert.throws(() => other.claims(token), /Invalid result link/);
});

test("a failed job's result says what went wrong, a Radiance LoRA refusal word for word", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-result-failure-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const media = new McpMedia({ dataDir, baseUrl: "http://127.0.0.1:1", publicUrl: "https://studio.example.test", signingKey: "fixture-signing-key" });
  media.state.jobs["job-lora-1"] = "account-7";
  const refusal = "loras: none of the adapters' modules is a module of this model (zimage_style.safetensors)";
  media.job = async () => ({ status: "error", error: refusal, failure: { title: "A LoRA doesn't fit this model", summary: refusal } });
  const result = await media.result("account-7", "job-lora-1");
  const words = result.content.map((item) => item.text).join("\n");
  assert.match(words, /failed: loras: none of the adapters' modules is a module of this model \(zimage_style\.safetensors\)/);
  assert.match(words, /Do not resubmit/);
});
