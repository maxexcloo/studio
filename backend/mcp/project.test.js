import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { anyConstraints } from "../../shared/projects.ts";
import { createProjects, projectPatch } from "../domain/projects.ts";
import { closeRuntimeDatabase } from "../persistence/runtime.ts";
import {
  assertAvoided,
  briefLine,
  createChatChoices,
  keptChoices,
  projectArgs,
  projectFit,
  projectTargets,
  registerProjectTool,
  withoutTasteExclusions,
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
  brief: { description: "", styles: "", avoid: "", ...brief },
  constraints: { ...anyConstraints(), ...constraints },
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
  // Settings › Taste › Chat Choices lists and clears only the account's own chats.
  const alice = { userId: "alice" };
  const bob = { userId: "bob" };
  assert.deepEqual(
    choices.list(alice).map(({ at: _at, ...shown }) => shown),
    [{ chat: "chat-a", image: { tier: "fast" }, count: 2 }],
  );
  assert.deepEqual(choices.list(bob), []);
  choices.forget(bob, "chat-a");
  assert.equal(choices.list(alice).length, 1);
  choices.forget(alice, "chat-a");
  assert.deepEqual(choices.read("alice", "chat-a"), {});
});

test("Taste exclusions leave a prompt with what they name removed, unless little would remain", () => {
  const exclusions = ["smoking", "laundry rooms"];
  const { prompts, excluded, note } = withoutTasteExclusions(exclusions, [
    "A man smoking, on a bench at dusk",
    "A sunlit hall, no laundry rooms",
    "A smokestack over the harbour",
  ]);
  assert.deepEqual(prompts, [
    "A man, on a bench at dusk",
    "A sunlit hall",
    "A smokestack over the harbour",
  ]);
  assert.deepEqual(excluded, {
    "A man, on a bench at dusk": ["smoking"],
    "A sunlit hall": ["laundry rooms"],
  });
  assert.match(note, /"smoking" from prompt 1, "laundry rooms" from prompt 2/);
  assert.deepEqual(withoutTasteExclusions(exclusions, ["A quiet harbour"]).note, "");
  assert.throws(
    () => withoutTasteExclusions(exclusions, ["Smoking"]),
    /Prompt 1 is little more than "Smoking"/,
  );
});

test("set names persist per account and conversation while explicit names take priority", (t) => {
  const directory = dataDir(t);
  const choices = createChatChoices({ dataDir: directory });
  choices.remember("alice", "chat", { title: "Moonlit Fox Studies" });
  const reloaded = createChatChoices({ dataDir: directory });
  const input = { prompts: ["A fox by a tree"] };
  assert.equal(
    keptChoices(reloaded.read("alice", "chat"), input).args.title,
    "Moonlit Fox Studies",
  );
  assert.equal(keptChoices(reloaded.read("alice", "other"), input).args.title, undefined);
  assert.equal(keptChoices(reloaded.read("bob", "chat"), input).args.title, undefined);
  assert.equal(keptChoices(reloaded.read("alice", ""), input).args.title, undefined);
  assert.equal(
    keptChoices(reloaded.read("alice", "chat"), { ...input, title: "my chosen name" }).args.title,
    "my chosen name",
  );
});

test("a project's allowed inputs replace a call's LoRAs, size and numbers, saying what changed", () => {
  const constrained = project({
    loras: "none",
    aspects: ["16:9", "4:3"],
    resolutions: ["2K"],
    ranges: { steps: { min: 4, max: 8 } },
  });
  const { args, note } = projectArgs(constrained, {
    loras: [{ name: "glow" }],
    aspect: "1:1",
    resolution: "1K",
    steps: 20,
  });
  assert.deepEqual(args, { loras: [], aspect: "16:9", resolution: "2K", steps: 8 });
  assert.match(note, /LoRAs are off in Coast/);
  assert.match(note, /Coast allows 16:9, 4:3, so it ran 16:9/);
  assert.match(note, /Coast keeps Steps 20 → 8/);
  assert.equal(projectArgs(constrained, { aspect: "4:3" }).args.aspect, "4:3");
  assert.deepEqual(projectArgs(project(), { count: 2 }), {
    args: { count: 2 },
    note: "",
  });
  // As it queues, the profile's own defaults and resolved LoRAs keep to them too.
  const body = { steps: 30, cfg: 7, sound: true, loras: [{ name: "film" }, { name: "glow" }] };
  const fit = projectFit(project({ loras: ["film"], sound: false, ranges: { steps: { max: 8 } } }));
  assert.equal(
    fit({ capabilities: { sound: true } }, body),
    "Coast keeps Only its allowed LoRAs, Sound off, Steps 30 → 8.",
  );
  assert.deepEqual(body, { steps: 8, cfg: 7, sound: false, loras: [{ name: "film" }] });
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
  const coast = project({}, { description: "seabirds", avoid: "no people, text; boats" });
  assert.throws(
    () => assertAvoided(coast, ["Gulls", "Two people on a pier"]),
    /Prompt 2 names "people"/,
  );
  assert.throws(() => assertAvoided(coast, ["A gull over BOATS"]), /"boats"/);
  assert.doesNotThrow(() => assertAvoided(coast, ["Peoples' coast", "Textured rocks"]));
  assert.equal(
    briefLine(coast),
    "Project Coast: seabirds; avoid no people, text; boats. Keep prompts to it. ",
  );
  assert.equal(briefLine(project()), "");
});

test("projectPatch refuses unknown fields and values outside the constraints", () => {
  assert.throws(() => projectPatch({ colour: "red" }), /Unknown field colour/);
  assert.throws(() => projectPatch({ brief: { subjects: "x" } }), /Unknown brief field subjects/);
  assert.throws(() => projectPatch({ constraints: { aspects: ["5:4"] } }), /List aspects/);
  assert.deepEqual(projectPatch({ constraints: { aspects: ["3:4", "4:3"] } }).constraints, {
    aspects: ["3:4", "4:3"],
  });
  assert.throws(() => projectPatch({ constraints: { loras: "no" } }), /List at most/);
  assert.throws(() => projectPatch({ constraints: { sound: "on" } }), /Set sound/);
  assert.throws(
    () => projectPatch({ constraints: { ranges: { steps: { min: 9, max: 4 } } } }),
    /min no greater/,
  );
  assert.throws(() => projectPatch({ constraints: { ranges: { seed: {} } } }), /not seed/);
  assert.deepEqual(
    projectPatch({ constraints: { ranges: { cfg: { max: 4 }, steps: {} } } }).constraints,
    { ranges: { cfg: { max: 4 } } },
  );
  assert.throws(() => projectPatch({ name: " " }), /Name the project/);
  assert.deepEqual(projectPatch({ name: " Coast ", constraints: { profiles: ["a", "a"] } }), {
    name: "Coast",
    constraints: { profiles: ["a"] },
  });
});

/** The project tool over a real project store, answering its Studio routes in process. */
function projectTool(t, chat = "chat-a") {
  const clock = { now: Date.parse("2026-01-01T00:00:00Z") };
  const projects = createProjects({ dataDir: dataDir(t), now: () => clock.now });
  const owner = "alice";
  const media = {
    profiles: async () => [turbo, quality, video],
    async request(method, route, body) {
      const [, id, action] = /^\/api\/dream\/projects(?:\/([^/?]+))?(?:\/(\w+))?/.exec(route);
      if (id === "attach") return { project: projects.attach(owner, body.chat, body.projectId) };
      if (id === "activity") return { project: projects.activity(owner, body.chat) };
      if (method === "GET") {
        const asking = new URLSearchParams(route.split("?")[1]).get("chat");
        return {
          projects: projects.list(owner),
          ...(asking !== null && { project: projects.chatProject(owner, asking) }),
        };
      }
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
  return { call, projects, owner, clock };
}

test("the project tool creates, attaches, updates and shows a chat's project", async (t) => {
  const { call, projects, owner } = projectTool(t);
  assert.deepEqual(await call({}), { project: null, projects: [] });
  const created = await call({
    action: "create",
    name: "Coast",
    allowed: { loras: "none", sound: false },
    profiles: ["turbo"],
  });
  assert.equal(created.project.name, "Coast");
  assert.deepEqual(created.project.constraints.profiles, ["Moss · Super Fast"]);
  assert.equal(created.project.constraints.loras, "none");
  assert.equal(created.project.constraints.sound, false);
  const updated = await call({
    action: "update",
    avoid: "people",
    description: "A tall Australian surfer. Keep the outfit.",
    favourite_loras: ["film"],
    profiles: ["Moss · Quality"],
    allowed: { sound: null, ranges: { steps: { max: 8 } } },
  });
  assert.equal(updated.project.brief.avoid, "people");
  assert.equal(updated.project.brief.description, "A tall Australian surfer. Keep the outfit.");
  assert.deepEqual(updated.project.brief.loras, ["film"]);
  assert.match(briefLine(updated.project), /Keep the outfit\.; avoid people; LoRAs film/);
  assert.deepEqual(updated.project.constraints.profiles, ["Moss · Quality"]);
  assert.equal(updated.project.constraints.sound, undefined);
  assert.deepEqual(updated.project.constraints.ranges, { steps: { max: 8 } });
  assert.match(updated.note, /undo/);
  // The chat's change is the one Undo restores on the Dream page.
  const [stored] = projects.list(owner);
  assert.equal(stored.changes[0].by, "chat");
  assert.deepEqual(stored.previous.constraints.profiles, [turbo.id]);
  assert.deepEqual((await call({ action: "detach" })).project, null);
  assert.equal((await call({ action: "attach", project: "coast" })).project.name, "Coast");
  await assert.rejects(call({ action: "attach", project: "Harbour" }), /No project "Harbour"/);
});

test("showing a chat's project leaves its activity as it was, so Dream's turns resume on time", async (t) => {
  const { call, projects, owner, clock } = projectTool(t);
  await call({ action: "create", name: "Coast" });
  const attached = projects.chats(owner)["chat-a"].at;
  clock.now += 60_000;
  assert.equal((await call({ action: "show" })).project.name, "Coast");
  assert.equal(projects.chats(owner)["chat-a"].at, attached);
  await call({ action: "update", avoid: "people" });
  assert.equal(projects.chats(owner)["chat-a"].at, new Date(clock.now).toISOString());
});

test("project names stay unique per account, in any case", (t) => {
  const projects = createProjects({ dataDir: dataDir(t) });
  const coast = projects.create("alice", { name: "Coast" });
  const harbour = projects.create("alice", { name: "Harbour" });
  assert.throws(() => projects.create("alice", { name: "coast" }), /already have a project/);
  assert.throws(() => projects.update("alice", harbour.id, { name: "COAST" }, "you"), /already/);
  assert.equal(projects.update("alice", coast.id, { name: "Coast" }, "you").name, "Coast");
  assert.equal(projects.create("bob", { name: "Coast" }).name, "Coast");
});

test("the project tool needs a conversation id to hold a project", async (t) => {
  const { call } = projectTool(t, "");
  await assert.rejects(call({ action: "create", name: "Coast" }), /no conversation id/);
});
