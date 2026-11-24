import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { seedStyles } from "./assistant-presets.js";
import { temporaryFolder } from "./fixtures/temporary.js";
import { createPromptStyleStore } from "./prompt-styles.js";

const store = () => createPromptStyleStore({ dataDir: temporaryFolder("studio-prompt-styles-") });

test("a folder without styles has the seed until the first save records it", () => {
  const styles = store();
  const seeded = styles.list();
  assert.deepEqual(seeded.styles, seedStyles);
  assert.equal(seeded.meta, null);
  assert.equal(fs.existsSync(styles.file), false);
  assert.deepEqual(styles.versions(), []);

  const next = seeded.styles.map((style) =>
    style.id === "concise" ? { ...style, label: "Short", enabled: false } : style,
  );
  const saved = styles.save(next, { by: "admin", baseHash: seeded.hash });
  assert.equal(saved.meta.version, 2);
  assert.deepEqual(
    styles.versions().map(({ version, origin }) => [version, origin]),
    [
      [2, "studio"],
      [1, "seed"],
    ],
  );
  // A disabled style leaves the menu and rewrites; Custom stays last.
  assert.equal(styles.style("improve", "concise"), null);
  assert.equal(styles.usable("improve").at(-1).id, "custom");
  assert.equal(styles.list().styles.find((style) => style.id === "concise").label, "Short");
});

test("a stale edit is refused, and revert restores an earlier version as a new one", () => {
  const styles = store();
  const { styles: seed, hash } = styles.list();
  styles.save(seed.slice(1), { baseHash: hash });
  assert.throws(() => styles.save(seed, { baseHash: hash }), { status: 409 });
  const reverted = styles.revert(1, { baseHash: styles.list().hash });
  assert.equal(reverted.styles.length, seed.length);
  assert.equal(reverted.meta.version, 3);
});

test("each kind sorts enabled labels before Custom, and the default falls back to the first style", () => {
  const styles = store();
  const { styles: seed } = styles.list();
  const enhance = seed.find((style) => style.id === "enhance");
  const rest = seed.filter((style) => style !== enhance);
  styles.save([...rest].reverse().concat({ ...enhance, enabled: false }));
  const ids = (kind) => styles.usable(kind).map((style) => style.id);
  assert.deepEqual(ids("improve"), [
    ...rest.filter((style) => style.kind === "improve").map((style) => style.id),
    "custom",
  ]);
  assert.deepEqual(ids("animate"), [
    "action",
    "living",
    "changing-light",
    "cinematic",
    "atmosphere",
    "reaction",
    "playful",
    "reveal",
    "dialogue",
    "two-beats",
    "uncensored",
    "custom",
  ]);
  assert.deepEqual(ids("change"), [
    "add-prop",
    "expression",
    "hairstyle",
    "new-action",
    "new-angle",
    "closer-shot",
    "new-setting",
    "new-outfit-and-place",
    "new-pose",
    "photographic-realism",
    "illustrated-reframe",
    "relight",
    "remove-distraction",
    "repair-detail",
    "photographic-restage",
    "simple-background",
    "new-visual-treatment",
    "time-season-weather",
    "wardrobe-swap",
    "wider",
  ]);
  // An ID may repeat across kinds: cinematic identifies both a rewrite style and a motion theme.
  assert.equal(styles.style("animate", "cinematic").label, "Motivated Camera Move");
  assert.equal(styles.defaultId(), rest[0].id);
});

test("change templates send a complete request for the actions they target", () => {
  const styles = store();
  const allows = (action) =>
    styles.usable("change").filter((style) => style.actions.includes(action));
  assert.ok(allows("edit").some(({ id }) => id === "repair-detail"));
  assert.ok(allows("recreate").some(({ id }) => id === "new-angle"));
  for (const style of styles.usable("change")) assert.equal(style.actions.length, 1);
  for (const { id, instruction } of styles.usable("change"))
    assert.ok(instruction.length <= 500, `${id} fits the change request without clipping`);
});

test("a chat draft stays AI-Drafted until approved", () => {
  const styles = store();
  const { styles: seed } = styles.list();
  styles.save(seed.slice(0, 2), { origin: "chat", aiDrafted: true });
  assert.equal(styles.list().meta.aiDrafted, true);
  assert.equal(styles.approve({ by: "admin" }).meta.aiDrafted, false);
});

test("styles need a kind, their own IDs, a name, an instruction and one audience", () => {
  const styles = store();
  const style = { id: "noir", kind: "change", label: "Noir", instruction: "Noir: shadows." };
  for (const bad of [
    [style, style],
    [{ ...style, kind: "other" }],
    [{ ...style, id: "custom" }],
    [{ ...style, id: "Noir!" }],
    [{ ...style, instruction: " " }],
    [{ ...style, label: "" }],
    {},
  ])
    assert.throws(() => styles.save(bad), { status: 400 });
  assert.deepEqual(styles.save([{ ...style, extra: 1 }]).styles, [
    {
      id: "noir",
      kind: "change",
      label: "Noir",
      description: "",
      instruction: "Noir: shadows.",
      enabled: true,
    },
  ]);
});
