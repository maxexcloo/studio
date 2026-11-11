import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chatRecords } from "./chat-records.js";
import { Store } from "./domain/store.ts";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  runtimeDatabase,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("chatRecords plans Studio Chat's records, then deletes them and keeps what MCP uses", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-chat-records-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  assert.equal(chatRecords(dataDir).messages, 0);
  assert.deepEqual(fs.readdirSync(dataDir), [], "a dry run without a database makes none");

  const db = runtimeDatabase(dataDir);
  const store = new Store(db);
  // The table and records Studio Chat kept, as it stored them.
  db.exec(`CREATE TABLE studio_chat_messages (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES studio_sessions(id), record TEXT NOT NULL
    );
    CREATE INDEX studio_chat_session ON studio_chat_messages(owner_id, session_id);`);
  const chat = store.createSession("a", "Fox Ideas");
  const record = (session, extra) =>
    db
      .prepare("UPDATE studio_sessions SET record = ? WHERE id = ?")
      .run(JSON.stringify({ ...session, ...extra }), session.id);
  record(chat, { titleSource: "generated", archived: true });
  record(store.createSession("a", "Dream"), { hidden: true });
  record(store.createSession("a"), { mcp: {} });
  const conversation = store.mcpSession("a", "Teapots", "conversation-1");
  db.prepare("INSERT INTO studio_chat_messages VALUES (?, ?, ?, ?)").run(
    "message-1",
    "a",
    chat.id,
    JSON.stringify({ role: "user", content: "A fox" }),
  );
  writeRuntimeDocument(dataDir, "preferences:a", { chat: "cloud", images: "local" });
  writeRuntimeDocument(dataDir, "preferences:b", { images: "cloud" });
  writeRuntimeDocument(dataDir, "accounts", {
    profiles: {
      user: { id: "user", features: { chat: false, dream: true } },
      other: { id: "other", features: { dream: false } },
    },
    gatewayLinks: [{ user: "librechat-user", accountId: "a" }],
  });

  const plan = chatRecords(dataDir);
  assert.equal(plan.applied, false);
  assert.match(plan.note, /without a backup/);
  assert.deepEqual(
    [plan.messagesTable, plan.messages, plan.sessions, plan.preferences, plan.groups],
    [true, 1, 3, ["preferences:a"], ["user"]],
  );

  assert.equal(chatRecords(dataDir, { apply: true }).applied, true);
  assert.equal(
    db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'studio_chat%'").get(),
    undefined,
  );
  assert.deepEqual(store.session("a", chat.id), { ...chat, title: "Fox Ideas" });
  assert.deepEqual(store.session("a", conversation.id).mcp, { conversationId: "conversation-1" });
  assert.equal(store.mcpSession("a", "", "conversation-1").id, conversation.id);
  assert.deepEqual(readRuntimeDocument(dataDir, "preferences:a"), { images: "local" });
  const accounts = readRuntimeDocument(dataDir, "accounts");
  assert.deepEqual(accounts.profiles.user.features, { dream: true });
  assert.deepEqual(accounts.gatewayLinks, [{ user: "librechat-user", accountId: "a" }]);

  const again = chatRecords(dataDir, { apply: true });
  assert.deepEqual(
    [again.applied, again.messagesTable, again.sessions, again.preferences, again.groups],
    [false, false, 0, [], []],
  );
});
