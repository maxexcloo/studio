import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  closeRuntimeDatabase,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "./persistence/runtime.ts";
import { projectsSimplify } from "./projects-simplify.js";

test("projectsSimplify folds old briefs and constraints, once, and a conflict applies nothing", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-projects-simplify-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const old = (brief, constraints = {}) => ({
    name: "Coast",
    brief: { subjects: "", styles: "", avoid: "", ...brief },
    constraints: { profiles: [], loras: true, aspect: "", resolution: "", ...constraints },
  });
  writeRuntimeDocument(dataDir, "projects:alice", {
    chats: {},
    projects: [
      {
        id: "coast",
        ...old(
          { subjects: "seabirds", age: "30–40", rules: "Keep the coat", styles: "film" },
          { loras: false, aspect: "portrait", resolution: "2K", profiles: ["turbo"] },
        ),
        previous: { ...old({ subjects: "gulls" }), change: "c1" },
        changes: [
          {
            id: "c1",
            fields: ["subjects", "rules", "styles"],
            text: {
              subjects: { before: "gulls", after: "seabirds" },
              rules: { before: "", after: "Keep the coat" },
              styles: { before: "", after: "film" },
            },
          },
        ],
      },
    ],
  });
  writeRuntimeDocument(dataDir, "inbox:alice", {
    proposals: [
      { id: "new", change: { project: old({ subjects: "harbours" }) } },
      { id: "vary", change: { brief: { rules: "vary the light" } } },
      { id: "style", change: { brief: { styles: "noir" } } },
    ],
  });
  const plan = {
    applied: false,
    projects: [{ account: "alice", project: "Coast" }],
    proposals: [{ account: "alice", moved: 1, dropped: 1 }],
    conflicts: [],
  };
  assert.deepEqual(projectsSimplify(dataDir), plan);
  assert.deepEqual(projectsSimplify(dataDir, { apply: true }), { ...plan, applied: true });
  const [coast] = readRuntimeDocument(dataDir, "projects:alice").projects;
  assert.deepEqual(coast.brief, {
    description: "seabirds\nAge: 30–40\nRules: Keep the coat",
    styles: "film",
    avoid: "",
  });
  assert.deepEqual(coast.constraints, {
    profiles: ["turbo"],
    aspects: ["portrait"],
    resolutions: ["2K"],
    loras: "none",
    ranges: {},
  });
  assert.equal(coast.previous.brief.description, "gulls");
  assert.equal(coast.previous.change, "c1");
  assert.deepEqual(coast.changes[0].fields, ["description", "styles"]);
  assert.deepEqual(coast.changes[0].text.description, {
    before: "gulls",
    after: "seabirds\nRules: Keep the coat",
  });
  const inbox = readRuntimeDocument(dataDir, "inbox:alice");
  assert.deepEqual(
    inbox.proposals.map((proposal) => proposal.id),
    ["new", "style"],
  );
  assert.equal(inbox.proposals[0].change.project.brief.description, "harbours");
  assert.deepEqual(projectsSimplify(dataDir), {
    applied: false,
    projects: [],
    proposals: [],
    conflicts: [],
  });

  writeRuntimeDocument(dataDir, "projects:bob", {
    chats: {},
    projects: [{ id: "long", ...old({ subjects: "x".repeat(400), rules: "y".repeat(300) }) }],
  });
  const conflicted = projectsSimplify(dataDir, { apply: true });
  assert.equal(conflicted.applied, false);
  assert.match(conflicted.conflicts[0], /bob\/Coast: its brief would run to 708 characters/);
});
