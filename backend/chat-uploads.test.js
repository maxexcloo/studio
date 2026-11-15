import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chatUploads } from "./chat-uploads.js";

test("each new chat image is sent once as its person's upload, after a failure too", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "studio-chat-uploads-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const write = (user, name) => {
    fs.mkdirSync(path.join(folder, user), { recursive: true });
    fs.writeFileSync(path.join(folder, user, name), `${user}/${name}`);
  };
  write("alice", "old__before.png");
  const sent = [];
  let status = 503;
  const uploads = chatUploads({
    folder,
    url: "http://studio.test/mcp",
    key: "gateway-key",
    fetch: async (url, { headers, body }) => {
      sent.push({ url, user: headers["x-ai-user-id"], body: String(body) });
      return new Response("", { status });
    },
  });
  await uploads.skipExisting();
  write("alice", "f1__beach photo.png");
  write("alice", "avatar.png");
  write("bob", "f2__dog.webp");
  const later = Date.now() + 5000;
  // Still being written: nothing yet.
  await uploads.scan(Date.now() - 5000);
  assert.deepEqual(sent, []);
  // Studio is down, so both are sent again once it answers.
  await uploads.scan(later);
  status = 201;
  await uploads.scan(later);
  await uploads.scan(later);
  assert.deepEqual(sent.slice(2), [
    {
      url: "http://studio.test/mcp/uploads?name=beach%20photo.png",
      user: "alice",
      body: "alice/f1__beach photo.png",
    },
    { url: "http://studio.test/mcp/uploads?name=dog.webp", user: "bob", body: "bob/f2__dog.webp" },
  ]);
  // A refusal, such as an unlinked person's, is not retried.
  status = 403;
  write("carol", "f3__cat.png");
  await uploads.scan(later);
  await uploads.scan(later);
  assert.equal(sent.length, 5);
});

test("a backfill sends each linked person's existing chat images and skips the unlinked", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "studio-chat-uploads-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const [user, name] of [
    ["alice", "f1__one.png"],
    ["alice", "f2__two.png"],
    ["alice", "avatar.png"],
    ["carol", "f3__cat.png"],
  ]) {
    fs.mkdirSync(path.join(folder, user), { recursive: true });
    fs.writeFileSync(path.join(folder, user, name), name);
  }
  const sent = [];
  const uploads = chatUploads({
    folder,
    url: "http://studio.test/mcp",
    key: "gateway-key",
    fetch: async (url, { headers, body }) => {
      const user = headers["x-ai-user-id"];
      if (body.length) sent.push(`${user}/${body}`);
      return new Response("", { status: user === "carol" ? 403 : body.length ? 201 : 400 });
    },
  });
  const row = (user, images, bytes, linked, sent = 0) => ({
    user,
    images,
    bytes,
    sent,
    failed: 0,
    linked,
  });
  const counted = await uploads.backfill({ dryRun: true });
  assert.deepEqual(sent, []);
  assert.deepEqual(
    counted.sort((a, b) => a.user.localeCompare(b.user)),
    [row("alice", 2, 22, true), row("carol", 1, 11, false)],
  );
  const report = await uploads.backfill();
  assert.deepEqual(sent.sort(), ["alice/f1__one.png", "alice/f2__two.png"]);
  assert.deepEqual(
    report.sort((a, b) => a.user.localeCompare(b.user)),
    [row("alice", 2, 22, true, 2), row("carol", 1, 11, false)],
  );
});
