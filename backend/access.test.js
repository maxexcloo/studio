import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-access-"));
process.env.STUDIO_DATA_DIR = path.join(temporary, "data");
process.env.STUDIO_WORKERS = JSON.stringify([
  {
    id: "primary",
    url: "http://127.0.0.1:9",
    capabilities: ["image", "video", "upscale", "models"],
  },
]);

const { canAdmin } = await import("./access.js");

const request = (address, headers = {}) => ({ socket: { remoteAddress: address }, headers });

test("single-user admin is this computer only, never another device or a proxy", () => {
  assert.equal(canAdmin(request("127.0.0.1")), true);
  assert.equal(canAdmin(request("::ffff:192.168.1.40")), false);
  assert.equal(canAdmin(request("127.0.0.1", { "x-forwarded-for": "203.0.113.4" })), false);
});
