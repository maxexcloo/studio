import fs from "node:fs";
import { databaseFile, runtimeDatabase } from "./persistence/runtime.ts";
import { isObject } from "./values.js";

/**
 * The migrate-runtime step that deletes what Studio Chat stored, now that people chat through
 * LibreChat: the `studio_chat_messages` table, the session marks only the Chats list read
 * (`titleSource`, `archived`, `hidden` and an MCP mark without a conversation), the `chat`
 * preference (where Chat ran) and each group's `chat` feature. Sessions stay, since they hold the
 * queue's job records; so do MCP's records (`mcp-ownership`, the conversation result numbers, the
 * assistant's records) and the gateway links. Nothing reads these records any more, so the step is
 * safe while Studio runs; it reloads the accounts and preferences it rewrites. Plans by default
 * with counts; `apply` deletes for good. A second run finds nothing.
 */
export const chatRecordsNote = "Deletes Studio Chat's messages and chat-only marks for good.";
const marks = "'$.titleSource', '$.archived', '$.hidden'";
const marked =
  "json_type(record, '$.titleSource') IS NOT NULL OR json_type(record, '$.archived') IS NOT NULL OR json_type(record, '$.hidden') IS NOT NULL";
// An MCP session without a conversation was marked only so Chat could poll it.
const bareMcp =
  "json_type(record, '$.mcp') IS NOT NULL AND json_extract(record, '$.mcp.conversationId') IS NULL";

/** What a plan lists to do: dropping the messages table counts once, beside each record changed. */
export const chatRecordChanges = (plan) =>
  Number(plan.messagesTable) + plan.sessions + plan.preferences.length + plan.groups.length;

export function chatRecords(dataDir, { apply = false } = {}) {
  const result = {
    applied: false,
    note: chatRecordsNote,
    messagesTable: false,
    messages: 0,
    sessions: 0,
    preferences: [],
    groups: [],
  };
  // A dry run on a folder without a database leaves it without one.
  if (!fs.existsSync(databaseFile(dataDir))) return result;
  const db = runtimeDatabase(dataDir);
  const table = (name) =>
    Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name));
  const count = (sql) => Number(Object.values(db.prepare(sql).get())[0]);
  const messages = table("studio_chat_messages");
  const sessions = table("studio_sessions");
  result.messagesTable = messages;
  if (messages) result.messages = count("SELECT COUNT(*) FROM studio_chat_messages");
  if (sessions)
    result.sessions = count(`SELECT COUNT(*) FROM studio_sessions WHERE ${marked} OR ${bareMcp}`);
  const preferences = db
    .prepare("SELECT name, value FROM studio_documents WHERE substr(name, 1, 12) = 'preferences:'")
    .all()
    .map((row) => ({ name: String(row.name), value: JSON.parse(String(row.value)) }))
    .filter(({ value }) => isObject(value) && Object.hasOwn(value, "chat"));
  result.preferences = preferences.map(({ name }) => name);
  const accountsRow = db
    .prepare("SELECT value FROM studio_documents WHERE name = 'accounts'")
    .get();
  const accounts = accountsRow ? JSON.parse(String(accountsRow.value)) : null;
  const groups = isObject(accounts?.profiles) ? accounts.profiles : {};
  result.groups = Object.keys(groups).filter(
    (id) => isObject(groups[id]?.features) && Object.hasOwn(groups[id].features, "chat"),
  );
  if (!apply || !chatRecordChanges(result)) return result;

  const write = db.prepare("UPDATE studio_documents SET value = ? WHERE name = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DROP TABLE IF EXISTS studio_chat_messages");
    if (sessions)
      db.exec(`UPDATE studio_sessions SET record = json_remove(record, ${marks}) WHERE ${marked};
        UPDATE studio_sessions SET record = json_remove(record, '$.mcp') WHERE ${bareMcp};`);
    for (const { name, value } of preferences) {
      const { chat: _chat, ...rest } = value;
      write.run(JSON.stringify(rest), name);
    }
    if (result.groups.length) {
      const profiles = Object.fromEntries(
        Object.entries(groups).map(([id, group]) => {
          if (!result.groups.includes(id)) return [id, group];
          const { chat: _chat, ...features } = group.features;
          return [id, { ...group, features }];
        }),
      );
      write.run(JSON.stringify({ ...accounts, profiles }), "accounts");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  result.applied = true;
  return result;
}
