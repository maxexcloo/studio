import { randomUUID } from "node:crypto";

import { maxContextNotes } from "../../shared/characters.ts";
import type { ChatNote } from "../../shared/dream.ts";
import {
  ownerDocumentName,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";

const maxNotes = 50;
const keptMs = 30 * 24 * 60 * 60_000;
const failure = (message: string) => Object.assign(new Error(message), { status: 400 });

/** Each account's latest chat context (MCP), newest first: at most 50, none older than 30 days. */
export function createChatNotes({
  dataDir,
  now = Date.now,
}: {
  dataDir: string;
  now?: () => number;
}) {
  const name = (ownerId: string) => ownerDocumentName("chat-notes", ownerId);
  const list = (ownerId: string) =>
    ((readRuntimeDocument(dataDir, name(ownerId)) as ChatNote[] | undefined) ?? []).filter(
      (note) => now() - Date.parse(note.at) < keptMs,
    );
  const write = (ownerId: string, notes: ChatNote[]) => {
    writeRuntimeDocument(dataDir, name(ownerId), notes.slice(0, maxNotes));
    return list(ownerId);
  };
  return {
    list,
    add(ownerId: string, { text, project, results, card }: Omit<ChatNote, "id" | "at">) {
      if (typeof text !== "string" || !text.trim()) throw failure("Write the note.");
      if (text.trim().length > maxContextNotes)
        throw failure(`Keep the note to ${maxContextNotes} characters.`);
      if (
        results !== undefined &&
        (!Array.isArray(results) ||
          results.length > 30 ||
          results.some((id) => typeof id !== "string"))
      )
        throw failure("List the note's results by id.");
      const notes = list(ownerId);
      const wording = text.trim();
      const projectId = project || undefined;
      const cardId = typeof card === "string" && card ? card : undefined;
      const same = notes.find(
        (other) =>
          other.text === wording &&
          other.project === projectId &&
          other.card === cardId &&
          Boolean(other.results?.length) === Boolean(results?.length),
      );
      const all = [...new Set([...(results ?? []), ...(same?.results ?? [])])].slice(0, 30);
      const note: ChatNote = {
        id: same?.id ?? randomUUID(),
        text: wording,
        at: new Date(now()).toISOString(),
        ...(projectId ? { project: projectId } : {}),
        ...(all.length ? { results: all } : {}),
        ...(cardId ? { card: cardId } : {}),
      };
      return write(ownerId, [note, ...notes.filter((other) => other !== same)]);
    },
    /** Leaves a deleted project's notes to the account's other work. */
    untie: (ownerId: string, projectId: string) =>
      write(
        ownerId,
        list(ownerId).map(({ project, ...note }) =>
          project === projectId ? note : { project, ...note },
        ),
      ),
    remove: (ownerId: string, id: string) =>
      write(
        ownerId,
        list(ownerId).filter((note) => note.id !== id),
      ),
  };
}

export type ChatNotes = ReturnType<typeof createChatNotes>;
