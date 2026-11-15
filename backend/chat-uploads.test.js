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
