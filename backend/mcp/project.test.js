import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProjects, projectPatch } from "../domain/projects.ts";
import { closeRuntimeDatabase } from "../persistence/runtime.ts";
import {
  assertAvoided,
  briefLine,
  createChatChoices,
  keptChoices,
  projectArgs,
  projectTargets,
  registerProjectTool,
} from "./project.js";

const dataDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-project-"));
  t.after(() => {
    closeRuntimeDatabase(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};
const project = (constraints = {}, brief = {}) => ({
  name: "Coast",
  brief: { subjects: "", styles: "", avoid: "", ...brief },
  constraints: {
    profiles: [],
    loras: true,
    aspect: "",
    resolution: "",
    ...constraints,
  },
});
const turbo = {
  id: "turbo-image",
  kind: "image",
  label: "Moss · Super Fast",
  mediaInputs: [],
};
const quality = {
  id: "quality-image",
  kind: "image",
  label: "Moss · Quality",
  mediaInputs: [{}],
};
const video = { id: "video", kind: "video", label: "Video", mediaInputs: [] };

test("a conversation keeps its own LoRAs off, tier and count where a call leaves them out", (t) => {
  const choices = createChatChoices({ dataDir: dataDir(t) });
  choices.remember("alice", "chat-a", {
    loras: [],
    tier: "turbo",
    count: 2,
    prompts: ["a"],
  });
  const kept = keptChoices(choices.read("alice", "chat-a"), {
    prompts: ["b", "c"],
  });
  assert.deepEqual(kept.args, {
    prompts: ["b", "c"],
    loras: [],
    tier: "turbo",
    count: 2,
  });
  assert.deepEqual(kept.kept, ["no LoRAs", "turbo", "2 each"]);
  // What the call names wins, and naming LoRAs turns them back on.
  choices.remember("alice", "chat-a", {
    loras: [{ name: "glow" }],
    tier: "fast",
  });
  assert.deepEqual(keptChoices(choices.read("alice", "chat-a"), { profile_id: "x" }).kept, []);
  assert.equal(choices.read("alice", "chat-a").loras, undefined);
  // Another conversation, another account or no conversation keeps nothing.
  assert.deepEqual(choices.read("alice", "chat-b"), {});
  assert.deepEqual(choices.read("bob", "chat-a"), {});
  assert.deepEqual(choices.read("alice", ""), {});
});

test("a project's constraints replace a call's LoRAs and size, saying what changed", () => {
  const { args, note } = projectArgs(project({ loras: false, aspect: "16:9", resolution: "2K" }), {
    loras: [{ name: "glow" }],
    width: 512,
    height: 512,
    resolution: "1K",
  });
  assert.deepEqual(args, { loras: [], aspect: "16:9", resolution: "2K" });
  assert.match(note, /LoRAs are off in Coast/);
  assert.match(note, /Coast is 16:9/);
  assert.match(note, /Coast is 2K/);
  assert.deepEqual(projectArgs(project(), { count: 2 }), {
    args: { count: 2 },
    note: "",
  });
});

test("a project runs only its listed profiles of the work's kind", () => {
  const constrained = project({ profiles: [turbo.id, video.id] });
  const targets = (...profiles) => profiles.map((profile) => ({ profile, note: "" }));
  const known = [turbo, quality, video];
  const swapped = projectTargets(constrained, targets(quality), known);
  assert.deepEqual(swapped.targets, targets(turbo));
  assert.match(
    swapped.note,
    /Coast runs only on Moss · Super Fast, so Moss · Super Fast ran instead of Moss · Quality/,
  );
  assert.deepEqual(projectTargets(constrained, targets(turbo), known).note, "");
  // Without a listed profile of that kind, any runs.
  const none = projectTargets(project({ profiles: [video.id] }), targets(quality), known);
  assert.deepEqual(none, { targets: targets(quality), note: "" });
});

test("prompts naming what the brief avoids are refused before queuing", () => {
  const coast = project({}, { subjects: "seabirds", avoid: "no people, text; boats" });
  assert.throws(
    () => assertAvoided(coast, ["Gulls", "Two people on a pier"]),
    /Prompt 2 names "people"/,
  );
  assert.throws(() => assertAvoided(coast, ["A gull over BOATS"]), /"boats"/);
  assert.doesNotThrow(() => assertAvoided(coast, ["Peoples' coast", "Textured rocks"]));
  assert.equal(
    briefLine(coast),
    "Project Coast: subjects seabirds; avoid no people, text; boats. Keep prompts to it. ",
  );
  assert.equal(briefLine(project()), "");
});

test("projectPatch refuses unknown fields and values outside the constraints", () => {
  assert.throws(() => projectPatch({ colour: "red" }), /Unknown field colour/);
  assert.throws(() => projectPatch({ constraints: { aspect: "5:4" } }), /Set aspect/);
  assert.throws(() => projectPatch({ constraints: { loras: "no" } }), /Set loras/);
  assert.throws(() => projectPatch({ name: " " }), /Name the project/);
  assert.deepEqual(projectPatch({ name: " Coast ", constraints: { profiles: ["a", "a"] } }), {
    name: "Coast",
    constraints: { profiles: ["a"] },
  });
});

/** The project tool over a real project store, answering its Studio routes in process. */
function projectTool(t, chat = "chat-a") {
  const projects = createProjects({ dataDir: dataDir(t) });
  const owner = "alice";
  const media = {
    profiles: async () => [turbo, quality, video],
    async request(method, route, body) {
      const [, id, action] = /^\/api\/dream\/projects(?:\/([^/?]+))?(?:\/(\w+))?/.exec(route);
      if (id === "attach") return { project: projects.attach(owner, body.chat, body.projectId) };
      if (id === "activity") return { project: projects.activity(owner, body.chat) };
      if (method === "GET") return { projects: projects.list(owner) };
      if (method === "POST" && !id) return { project: projects.create(owner, projectPatch(body)) };
      if (method === "PUT")
        return {
          project: projects.update(owner, id, projectPatch(body), "chat"),
        };
      throw new Error(`Unexpected ${method} ${route} ${action}`);
    },
  };
  let run;
  registerProjectTool({
    tool: (_server, _name, _title, _description, _schema, action) => (run = action),
    server: {},
    media,
    owner,
    chat,
    namedInTier: (all, value) => ({
      profile: all.find((profile) => profile.label === value),
    }),
  });
  const call = async (args) => JSON.parse((await run(args)).content[0].text);
  return { call, projects, owner };
}

test("the project tool creates, attaches, updates and shows a chat's project", async (t) => {
  const { call, projects, owner } = projectTool(t);
  assert.deepEqual(await call({}), { project: null, projects: [] });
  const created = await call({
    action: "create",
    name: "Coast",
    loras: false,
    profiles: ["turbo"],
  });
  assert.equal(created.project.name, "Coast");
  assert.deepEqual(created.project.constraints.profiles, ["Moss · Super Fast"]);
  assert.equal(created.project.constraints.loras, false);
  const updated = await call({
    action: "update",
    avoid: "people",
    profiles: ["Moss · Quality"],
  });
  assert.equal(updated.project.brief.avoid, "people");
  assert.deepEqual(updated.project.constraints.profiles, ["Moss · Quality"]);
  assert.match(updated.note, /undo/);
  // The chat's change is the one Undo restores on the Dream page.
  const [stored] = projects.list(owner);
  assert.equal(stored.previous.by, "chat");
  assert.deepEqual(stored.previous.constraints.profiles, [turbo.id]);
  assert.deepEqual((await call({ action: "detach" })).project, null);
  assert.equal((await call({ action: "attach", project: "coast" })).project.name, "Coast");
  await assert.rejects(call({ action: "attach", project: "Harbour" }), /No project "Harbour"/);
});

test("the project tool needs a conversation id to hold a project", async (t) => {
  const { call } = projectTool(t, "");
  await assert.rejects(call({ action: "create", name: "Coast" }), /no conversation id/);
});
