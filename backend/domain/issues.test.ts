import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { tasteLimits } from "../../shared/taste.ts";
import { closeRuntimeDatabase } from "../persistence/runtime.ts";
import { type IssueItem, createIssues } from "./issues.ts";
import { type TasteWriter, createTaste } from "./taste.ts";

const now = Date.parse("2026-11-18T00:00:00Z");
const at = (days: number) => new Date(now - days * 86_400_000).toISOString();

function fixture(t: TestContext, reply: unknown) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-issues-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const taste = createTaste({ dataDir, now: () => now });
  const items: IssueItem[] = [
    { id: "a", jobId: "job-1", createdAt: at(1), thumbnailUrl: "/thumb/a" },
    {
      id: "b",
      jobId: "job-2",
      createdAt: at(2),
      review: { miss: "breaks 'clear waist': waist wide" },
    },
    { id: "c", jobId: "job-3", createdAt: at(3) },
  ];
  const requests: Record<string, string> = {
    "job-1": "Her waist is still too wide",
    "job-2": "More variety please",
    "job-3": "Her waist is still too wide",
  };
  const asked: string[] = [];
  const writer: TasteWriter = {
    settings: () => ({}),
    model: async () => "test",
    async chat({ messages }) {
      asked.push(messages[1].content);
      return { text: JSON.stringify(reply) };
    },
  };
  const issues = createIssues({
    dataDir,
    taste,
    recent: (_ownerId, since) => items.filter((item) => Date.parse(item.createdAt!) >= since),
    request: (jobId) => requests[jobId] || "",
    writer: () => writer,
    updates: () => false,
    now: () => now,
  });
  return { issues, taste, asked };
}

test("issues group recurring complaints, suggest a rule and drop out once accepted or dismissed", async (t) => {
  const { issues, taste, asked } = fixture(t, {
    issues: [
      { issue: "Waist too wide", entries: [1, 2, 3], rule: "always a clearly narrow waist" },
      { issue: "Wanted variety", entries: [3] },
      { issue: "Extra fingers", entries: [1, 2], rule: "" },
    ],
  });
  taste.record("alice", [{ kind: "report", itemId: "c", issue: "Body: waist too wide" }]);
  const read = await issues.refresh("alice");
  // One entry per distinct text: the repeated chat request counts once with both its results.
  assert.deepEqual(asked[0].split("\n"), [
    "1. [report] Body: waist too wide",
    "2. [review] breaks 'clear waist': waist wide",
    "3. [chat] Her waist is still too wide",
    "4. [chat] More variety please",
  ]);
  assert.deepEqual(
    read.issues.map(({ issue, rule, count, sources }) => ({ issue, rule, count, sources })),
    [
      {
        issue: "Waist too wide",
        rule: "always a clearly narrow waist",
        count: 3,
        sources: { report: 1, review: 1, chat: 1 },
      },
      { issue: "Extra fingers", rule: "", count: 2, sources: { report: 1, review: 1, chat: 0 } },
    ],
  );
  assert.deepEqual(
    read.issues[0].examples.map((example) => example.id),
    ["a", "b", "c"],
  );
  // Nothing is a rule until the person accepts one.
  assert.deepEqual(taste.read("alice").rules, []);
  const accepted = issues.accept("alice", "always a clearly narrow waist");
  assert.deepEqual(taste.read("alice").rules, ["always a clearly narrow waist"]);
  assert.deepEqual(
    accepted.issues.map((issue) => issue.issue),
    ["Extra fingers"],
  );
  assert.deepEqual(issues.dismiss("alice", "Extra fingers").issues, []);
  // A full list refuses another rule.
  taste.edit("alice", { rules: Array.from({ length: tasteLimits.rules }, (_, n) => `rule ${n}`) });
  assert.throws(() => issues.accept("alice", "no visible text"), /Rules are full/);
});
