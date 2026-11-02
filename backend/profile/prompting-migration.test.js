import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { metadataFromJson } from "../custom-workflows.js";
import { loadMcpPrompting } from "../mcp/prompting.js";
import { restoreRuntimeBackup } from "../persistence/migration.ts";
import { profilePrompting } from "./prompting-migration.js";
import { createGuideStore, createProfileStore } from "./store.js";

const quiet = { info() {}, warn() {} };
const guides = {
  reviewed_on: "2026-10-01",
  families: { klein: { image: "klein" } },
  packs: {
    klein: {
      name: "Klein",
      summary: "Expand first.",
      rules: ["Write prose."],
      default_mode: "base",
      modes: {
        base: { name: "Base", rules: ["50 steps."] },
        fast: { name: "Fast", rules: ["8."] },
      },
    },
  },
  profiles: {},
  variants: {},
  negatives: { "custom:plain": { effect: "none", notes: "No negative." } },
};
const guideFile = (dir) => path.join(dir, "guides", "prompting.json");
/** The detailed guide each fixture profile carried a full copy of. */
const copy = (overrides = {}) => ({
  id: "klein",
  name: "Klein",
  summary: "Expand first.",
  rules: ["Write prose."],
  reviewed_on: "2026-10-01",
  mode: { id: "base", name: "Base", rules: ["50 steps."] },
  ...overrides,
});
const write = (dir, id, studio) =>
  fs.writeFileSync(
    path.join(dir, "workflows", `${id}.json`),
    `${JSON.stringify({ graph: {}, studio: { id, name: id, kind: "image", family: "klein", ...studio } }, null, 2)}\n`,
  );
const read = (dir, id) =>
  JSON.parse(fs.readFileSync(path.join(dir, "workflows", `${id}.json`), "utf8"));
/** What a profile (on a backend) reads now: its guide with its own fields over it. */
const resolved = (dir, id, backend = "") => {
  const workflow = metadataFromJson(read(dir, id), `${id}.json`, { backend });
  return loadMcpPrompting(guideFile(dir))({
    id: workflow.profileId,
    family: workflow.family,
    kind: workflow.kind,
    prompting: workflow.prompting,
  });
};

test("the profile prompting step keeps only what differs from each guide, with a backup it restores", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-prompting-migration-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "workflows"));
  fs.mkdirSync(path.join(dir, "guides"));
  fs.writeFileSync(guideFile(dir), JSON.stringify(guides));
  write(dir, "plain", { prompting: copy({ negative: guides.negatives["custom:plain"] }) });
  const optional = { effect: "optional", default: "", notes: "Leave it empty." };
  write(dir, "own-negative", { prompting: copy({ negative: optional }) });
  write(dir, "combined", {
    prompting: copy(),
    backend: "comfyui",
    backends: {
      comfyui: { graph: {} },
      radiance: {
        graph: {},
        prompting: copy({ mode: { id: "fast", name: "Fast", rules: ["8."] } }),
      },
    },
  });
  const before = {
    plain: resolved(dir, "plain"),
    "own-negative": resolved(dir, "own-negative"),
    radiance: resolved(dir, "combined", "radiance"),
  };
  const originals = Object.fromEntries(
    ["plain", "own-negative", "combined"].map((id) => [
      id,
      fs.readFileSync(path.join(dir, "workflows", `${id}.json`), "utf8"),
    ]),
  );

  const plan = profilePrompting(dir);
  assert.equal(plan.applied, false);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(plan.profiles).map(([id, changes]) => [
        id,
        changes.map(({ at, kept }) => [at, kept]),
      ]),
    ),
    {
      combined: [
        ["prompting", []],
        ["backends.radiance.prompting", ["mode"]],
      ],
      "own-negative": [["prompting", ["negative"]]],
      plain: [["prompting", []]],
    },
  );
  assert.equal(
    fs.readFileSync(path.join(dir, "workflows", "plain.json"), "utf8"),
    originals.plain,
    "a dry run writes nothing",
  );

  const applied = profilePrompting(dir, { apply: true });
  assert.equal(applied.applied, true);
  assert.equal(read(dir, "plain").studio.prompting, undefined);
  assert.deepEqual(read(dir, "own-negative").studio.prompting, { negative: optional });
  assert.deepEqual(read(dir, "combined").studio.backends.radiance.prompting, {
    mode: { id: "fast", name: "Fast", rules: ["8."] },
  });
  // Every profile reads exactly what its copy said.
  assert.deepEqual(
    {
      plain: resolved(dir, "plain"),
      "own-negative": resolved(dir, "own-negative"),
      radiance: resolved(dir, "combined", "radiance"),
    },
    before,
  );
  assert.equal(
    createProfileStore({ dataDir: dir, log: quiet }).versions("plain")[0].by,
    "migrate-runtime",
  );
  assert.deepEqual(profilePrompting(dir).profiles, {}, "a second run finds nothing");

  const restored = path.join(dir, "restored");
  assert.deepEqual(restoreRuntimeBackup(applied.backup, restored), { restored: 3 });
  for (const [id, text] of Object.entries(originals))
    assert.equal(fs.readFileSync(path.join(restored, "workflows", `${id}.json`), "utf8"), text);

  // A guide change now reaches every profile that doesn't keep that field itself.
  const store = createGuideStore({ dataDir: dir, seedFile: "", log: quiet });
  store.save("klein", { ...guides.packs.klein, summary: "Expand with an LLM." }, { by: "admin" });
  assert.equal(resolved(dir, "plain").summary, "Expand with an LLM.");
  assert.equal(resolved(dir, "combined", "radiance").summary, "Expand with an LLM.");
  assert.deepEqual(resolved(dir, "own-negative").negative, optional);
});
