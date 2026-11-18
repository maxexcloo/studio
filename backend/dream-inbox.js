import { randomUUID } from "node:crypto";

import { cardKinds } from "../shared/characters.ts";
import { ownerDocuments, savedDocument, writeRuntimeDocument } from "./persistence/runtime.ts";

// As the Inbox snoozes a dismissal (domain/inbox.ts).
const snoozeMs = 14 * 86_400_000;
const lower = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * The migrate-runtime step for Dream › Projects' Inbox (domain/inbox.ts). Each account's suggested
 * cards (`suggestions` in `dream:<owner>`) become card proposals, and the cards it accepted or
 * dismissed (`declined`) and the issues it dismissed (`dismissed` in `issues:<owner>`) are snoozed
 * as the Inbox snoozes a dismissal; Dream's retired `suggestedAt` and `projectTurns` go. A project's
 * Undo (`previous.by`, "studio" or "chat") becomes its first change, by "you" or "chat". Plans by
 * default; `apply` writes. A second run finds nothing.
 */
export function dreamInbox(dataDir, { apply = false, now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  const until = new Date(now + snoozeMs).toISOString();
  const writes = new Map();
  const inboxOf = (owner) =>
    writes.get(`inbox:${owner}`) ?? {
      proposals: [],
      accepted: [],
      snoozed: [],
      reasons: [],
      ...savedDocument(dataDir, `inbox:${owner}`),
    };
  const snooze = (inbox, key) => {
    if (!inbox.snoozed.some((entry) => entry.key === key)) inbox.snoozed.push({ key, until });
  };
  let suggestions = 0;
  let snoozed = 0;
  let projects = 0;
  for (const { name, value } of ownerDocuments(dataDir, "dream")) {
    const retired = ["suggestions", "suggestedAt", "declined", "projectTurns"];
    if (!value || !retired.some((key) => Object.hasOwn(value, key))) continue;
    const owner = name.slice("dream:".length);
    const { suggestions: cards = [], declined = [], ...kept } = value;
    delete kept.suggestedAt;
    delete kept.projectTurns;
    const inbox = inboxOf(owner);
    for (const card of cards) {
      const key = `card:${card.kind}:${lower(card.name)}`;
      if (!cardKinds[card.kind] || inbox.proposals.some((entry) => entry.key === key)) continue;
      inbox.proposals.push({
        id: card.id || randomUUID(),
        key,
        kind: "card",
        title: card.name,
        why: `A ${cardKinds[card.kind].name} in ${card.itemIds?.length || 0} images you liked`,
        at: card.at || at,
        change: { card: { kind: card.kind, name: card.name, description: card.description } },
        evidence: card.itemIds || [],
      });
      suggestions++;
    }
    for (const entry of declined) {
      snooze(inbox, `card:${lower(entry)}`);
      snoozed++;
    }
    writes.set(name, kept);
    writes.set(`inbox:${owner}`, inbox);
  }
  for (const { name, value } of ownerDocuments(dataDir, "issues")) {
    if (!value || !Object.hasOwn(value, "dismissed")) continue;
    const owner = name.slice("issues:".length);
    const { dismissed = [], ...kept } = value;
    const inbox = inboxOf(owner);
    for (const issue of kept.issues || [])
      if (issue.rule && dismissed.includes(lower(issue.issue))) {
        snooze(inbox, `rule:${lower(issue.rule)}`);
        snoozed++;
      }
    writes.set(name, kept);
    writes.set(`inbox:${owner}`, inbox);
  }
  for (const { name, value } of ownerDocuments(dataDir, "projects")) {
    const stale = (value?.projects || []).filter((project) => project.previous?.by);
    if (!stale.length) continue;
    for (const project of stale) {
      const { by, ...previous } = project.previous;
      const change = {
        id: randomUUID(),
        at: project.updatedAt || at,
        by: by === "chat" ? "chat" : "you",
        why: "",
        fields: [
          ...(previous.name === project.name ? [] : ["name"]),
          ...Object.keys({ ...previous.brief, ...project.brief }).filter(
            (key) =>
              JSON.stringify(previous.brief?.[key] || "") !==
              JSON.stringify(project.brief?.[key] || ""),
          ),
          ...(JSON.stringify(previous.constraints) === JSON.stringify(project.constraints)
            ? []
            : ["constraints"]),
        ],
      };
      project.previous = { ...previous, change: change.id };
      project.changes = [change, ...(project.changes || [])];
      projects++;
    }
    writes.set(name, value);
  }
  if (apply) for (const [name, value] of writes) writeRuntimeDocument(dataDir, name, value);
  return { applied: apply, suggestions, snoozed, projects, accounts: writes.size };
}
