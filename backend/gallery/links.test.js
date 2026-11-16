import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-links-"));
process.env.STUDIO_DATA_DIR = temporary;
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const { fetchPublic, importMediaLink } = await import("./links.js");

test("direct links reach only public addresses", async () => {
  for (const link of [
    "http://127.0.0.1/a.png",
    "http://[::1]/a.png",
    "http://[::ffff:127.0.0.1]/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/a.png",
    "http://localhost/a.png",
    "file:///etc/passwd",
  ])
    await assert.rejects(fetchPublic(link), /private address|http or https/, link);
});

test("a direct image link becomes an upload recording its source; other types are refused", async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  const answer = (body, type) => async () =>
    new Response(body, { headers: { "content-type": type } });
  const item = await importMediaLink("https://images.example.test/a%20fox.png", "acct", {
    fetch: answer(png, "image/png"),
  });
  assert.deepEqual(
    [item.source?.url, item.ownerId],
    ["https://images.example.test/a%20fox.png", "acct"],
  );
  await assert.rejects(
    importMediaLink("https://example.test/page", "acct", { fetch: answer("<html>", "text/html") }),
    /isn't a PNG, JPEG or WebP image/,
  );
});
