import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ChatMessage } from "../../shared/chat.ts";

export class ChatStore {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    // RewriteStore owns the schema. A stream cannot survive an application restart. Keep its partial answer visible.
    db.exec(
      "UPDATE studio_chat_messages SET record = json_set(record, '$.status', 'failed') WHERE json_extract(record, '$.status') = 'streaming'",
    );
  }
  /** The model that last answered for a model id, such as the local model behind a routing alias. */
  actualModel(modelId: string): string | undefined {
    const row = this.db
      .prepare(
        "SELECT json_extract(record, '$.actualModelId') AS actual FROM studio_chat_messages WHERE json_extract(record, '$.modelId') = ? AND json_extract(record, '$.actualModelId') IS NOT NULL ORDER BY rowid DESC LIMIT 1",
      )
      .get(modelId);
    return row ? String(row.actual) : undefined;
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
  /** Titles a chat once, unless the user renamed it first (`RewriteStore.updateSession`). */
  generatedTitle(ownerId: string, sessionId: string, title: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE studio_sessions SET record = json_set(record, '$.title', ?, '$.titleSource', 'generated') WHERE id = ? AND owner_id = ? AND json_extract(record, '$.titleSource') IS NULL",
        )
        .run(title, sessionId, ownerId).changes > 0
    );
  }
  save(ownerId: string, message: ChatMessage) {
    this.db
      .prepare("UPDATE studio_chat_messages SET record = ? WHERE id = ? AND owner_id = ?")
      .run(JSON.stringify(message), message.id, ownerId);
  }
}
