import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { dreamInbox } from "./dream-inbox.js";
import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";

test("dreamInbox moves suggested cards to the Inbox, snoozes what was turned down and keeps project Undo", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-dream-inbox-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const now = Date.parse("2026-11-18T00:00:00Z");
  const until = new Date(now + 14 * 86_400_000).toISOString();
  writeRuntimeDocument(dataDir, "dream:a", {
    settings: { enabled: true },
    projectTurns: 4,
    suggestedAt: "2026-11-17T00:00:00Z",
    suggestions: [
      {
        id: "mara",
        kind: "characters",
        name: "Mara",
        description: "Red hair.",
        itemIds: ["1", "2"],
        at: "2026-11-17T00:00:00Z",
      },
    ],
    declined: ["scenes:rooftop"],
  });
  writeRuntimeDocument(dataDir, "dream:b", { settings: { enabled: false } });
  writeRuntimeDocument(dataDir, "issues:a", {
    updatedAt: "",
    issues: [{ issue: "Waist too wide", rule: "always a narrow waist", count: 2 }],
    dismissed: ["waist too wide"],
  });
  const content = { brief: { subjects: "sea", styles: "", avoid: "" }, constraints: {} };
  writeRuntimeDocument(dataDir, "projects:a", {
    chats: {},
    projects: [
      {
        id: "beach",
        name: "Beach",
        ...content,
        brief: { ...content.brief, styles: "film" },
        updatedAt: "2026-11-16T00:00:00Z",
        previous: { name: "Beach", ...content, by: "studio" },
      },
    ],
  });

  const plan = { suggestions: 1, snoozed: 2, projects: 1, accounts: 4 };
  assert.deepEqual(dreamInbox(dataDir, { now }), { applied: false, ...plan });
  assert.ok(readRuntimeDocument(dataDir, "dream:a").suggestions);
  assert.deepEqual(dreamInbox(dataDir, { apply: true, now }), { applied: true, ...plan });
  assert.deepEqual(readRuntimeDocument(dataDir, "dream:a"), { settings: { enabled: true } });
  assert.deepEqual(readRuntimeDocument(dataDir, "issues:a").dismissed, undefined);
  const inbox = readRuntimeDocument(dataDir, "inbox:a");
  assert.deepEqual(
    inbox.proposals.map(({ id, key, kind, change, evidence }) => ({
      id,
      key,
      kind,
      change,
      evidence,
    })),
    [
      {
        id: "mara",
        key: "card:characters:mara",
        kind: "card",
        change: { card: { kind: "characters", name: "Mara", description: "Red hair." } },
        evidence: ["1", "2"],
      },
    ],
  );
  assert.deepEqual(inbox.snoozed, [
    { key: "card:scenes:rooftop", until },
    { key: "rule:always a narrow waist", until },
  ]);
  const [beach] = readRuntimeDocument(dataDir, "projects:a").projects;
  assert.deepEqual(
    beach.changes.map(({ by, fields }) => ({ by, fields })),
    [{ by: "you", fields: ["styles"] }],
  );
  assert.equal(beach.previous.change, beach.changes[0].id);
  assert.equal(beach.previous.by, undefined);
  assert.deepEqual(dreamInbox(dataDir, { now }), {
    applied: false,
    suggestions: 0,
    snoozed: 0,
    projects: 0,
    accounts: 0,
  });
});
