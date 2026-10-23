import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ChatMessage } from "../../shared/chat.ts";

export class ChatStore {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS studio_chat_messages (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES studio_sessions(id), record TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS studio_chat_session ON studio_chat_messages(owner_id, session_id);`);
    // A stream cannot survive an application restart. Keep its partial answer visible.
    db.exec(
      "UPDATE studio_chat_messages SET record = json_set(record, '$.status', 'failed') WHERE json_extract(record, '$.status') = 'streaming'",
    );
  }
  messages(ownerId: string, sessionId: string): ChatMessage[] {
    return this.db
      .prepare(
        "SELECT record FROM studio_chat_messages WHERE owner_id = ? AND session_id = ? ORDER BY rowid",
      )
      .all(ownerId, sessionId)
      .map((row) => JSON.parse(row.record as string));
  }
  add(
    ownerId: string,
    sessionId: string,
    value: Omit<ChatMessage, "id" | "sessionId" | "createdAt">,
  ): ChatMessage {
    const message = { ...value, id: randomUUID(), sessionId, createdAt: new Date().toISOString() };
    this.db
      .prepare("INSERT INTO studio_chat_messages VALUES (?, ?, ?, ?)")
      .run(message.id, ownerId, sessionId, JSON.stringify(message));
    this.db
      .prepare(
        "UPDATE studio_sessions SET updated_at = ?, record = json_set(record, '$.updatedAt', ?) WHERE id = ? AND owner_id = ?",
      )
      .run(message.createdAt, message.createdAt, sessionId, ownerId);
    return message;
  }
  save(ownerId: string, message: ChatMessage) {
    this.db
      .prepare("UPDATE studio_chat_messages SET record = ? WHERE id = ? AND owner_id = ?")
      .run(JSON.stringify(message), message.id, ownerId);
  }
}
