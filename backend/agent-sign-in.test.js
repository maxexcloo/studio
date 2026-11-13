import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-agent-sign-in-"));
process.env.STUDIO_DATA_DIR = path.join(temporary, "data");
const store = await import("./account-store.js");
const { listenForAgentSignIn } = await import("./agent-sign-in.js");
const socketPath = path.join(temporary, "sign-in.sock");
const server = listenForAgentSignIn(socketPath);
test.after(() => server.close());

async function ask(email) {
  const socket = net.connect(socketPath);
  socket.end(email);
  return JSON.parse(await text(socket));
}

test("signs in only the account with the given email, and logs no session", async (t) => {
  const own = await store.createLocalAccount({
    username: "max@example.com",
    password: "a long password one",
  });
  await store.createLocalAccount({
    username: "ginny@example.com",
    password: "a long password two",
  });
  const logged = [];
  t.mock.method(console, "log", (line) => logged.push(line));

  const reply = await ask("Max@Example.com\n");
  assert.equal(reply.name, "studio_account");
  assert.equal(store.accountSession(reply.value).userId, own.id);
  assert.equal(
    logged.some((line) => line.includes(reply.value)),
    false,
  );

  assert.deepEqual(await ask("someone@example.com"), { error: "No account has that email." });
});
