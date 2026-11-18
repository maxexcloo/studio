import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { characterLead, sheetView } from "../shared/characters.ts";
import { temporaryFolder } from "./fixtures/temporary.js";

process.env.STUDIO_DATA_DIR = temporaryFolder("studio-character-sheets-");
const { characterPrompt, createCharacterSheets, sheetPanels, sheetProfile, sheetReferences } =
  await import("./character-sheets.js");
const { createCard, listCards } = await import("./cards.js");

/** A sheet drawn to prompt-sheet.js's layout: boxes of colour on a light grey background. */
async function drawnSheet({ touching = false } = {}) {
  const box = (left, top, width, height) => ({
    input: { create: { width, height, channels: 3, background: "#7a4b2e" } },
    left,
    top,
  });
  const boxes = [
    // The face column: four close-ups.
    ...[0, 1, 2, 3].map((index) => box(60, 40 + index * 310, 260, touching ? 310 : 260)),
    // The turnaround at full height: front, side and back.
    box(520, 60, 300, 1100),
    box(1000, 70, 220, 1090),
    box(1400, 60, 300, 1100),
  ];
  return sharp({
    create: { width: 1920, height: 1280, channels: 3, background: "#e6e6e6" },
  })
    .composite(boxes)
    .png()
    .toBuffer();
}

const within = (panel, left, top, right, bottom) =>
  panel.left <= left &&
  panel.top <= top &&
  panel.left + panel.width >= right &&
  panel.top + panel.height >= bottom;

test("a sheet is cut into its face and three views by the background between them", async () => {
  const panels = await sheetPanels(await drawnSheet());
  const byRole = Object.fromEntries(panels.map((panel) => [panel.role, panel]));
  assert.deepEqual(Object.keys(byRole).sort(), ["back", "face", "front", "side"]);
  // Each holds its drawing, and no neighbour's.
  assert.ok(within(byRole.face, 60, 40, 320, 300));
  assert.ok(byRole.face.top + byRole.face.height < 350);
  assert.ok(within(byRole.front, 520, 60, 820, 1160));
  assert.ok(byRole.front.left + byRole.front.width < 1000);
  assert.ok(within(byRole.side, 1000, 70, 1220, 1160));
  assert.ok(within(byRole.back, 1400, 60, 1700, 1160));
});

test("close-ups stacked without gaps give the top quarter of the column as the face", async () => {
  const face = (await sheetPanels(await drawnSheet({ touching: true }))).find(
    (panel) => panel.role === "face",
  );
  assert.ok(within(face, 60, 40, 320, 340));
  assert.ok(face.top + face.height <= 360);
});

test("a sheet draws on a ready Qwen-Image 2.1 that takes an image, Quality before Turbo", () => {
  const slot = [{ id: "reference", kind: "image" }];
  const turbo = {
    id: "turbo",
    label: "Qwen-Image 2.1 Turbo · Fast · 8 Steps",
    kind: "image",
    family: "qwen_image_21",
    mediaInputs: slot,
  };
  const quality = {
    ...turbo,
    id: "quality",
    label: "Qwen-Image 2.1 · Quality · 40 Steps",
  };
  assert.equal(sheetProfile([turbo, quality]).id, "quality");
  assert.equal(sheetProfile([turbo, { ...quality, ready: false }]).id, "turbo");
  assert.equal(sheetProfile([{ ...quality, family: "flux2" }]), undefined);
});

test("a run takes the sheet's view its prompt names, and a subject video takes the sheet", () => {
  const card = {
    id: "chr-1",
    referenceIds: ["own"],
    sheet: {
      jobId: "job",
      panels: [
        { role: "face", referenceId: "face" },
        { role: "front", referenceId: "front" },
        { role: "side", referenceId: "side" },
        { role: "back", referenceId: "back" },
        { role: "sheet", referenceId: "sheet" },
      ],
    },
  };
  const placed = [{ assetId: "own", slot: "reference", strength: 0.8 }];
  const run = (prompt, options = {}) =>
    sheetReferences({ references: placed, prompt, cards: [card], ...options });
  assert.equal(sheetView("She walks away, seen from behind, back view"), "back");
  assert.deepEqual(run("Back view of her walking into the fog"), [
    { assetId: "back", slot: "reference", strength: 0.8 },
  ]);
  assert.equal(run("A close-up of her laughing")[0].assetId, "face");
  assert.equal(run("Side view, mid-stride")[0].assetId, "side");
  // No view named: the card's own first image.
  assert.equal(run("At a café table"), placed);
  const subjects = {
    kind: "video",
    editReferences: true,
    mediaInputs: [
      { id: "reference", kind: "image" },
      { id: "reference-2", kind: "image" },
    ],
  };
  assert.equal(run("She dances", { profile: subjects })[0].assetId, "sheet");
  // Animating a frame made with the character: its sheet joins in the next slot.
  assert.deepEqual(
    sheetReferences({
      references: [{ assetId: "frame", slot: "reference" }],
      prompt: "She dances",
      cards: [card],
      profile: subjects,
      madeWith: (id) => (id === "frame" ? ["front"] : []),
    }),
    [
      { assetId: "frame", slot: "reference" },
      { assetId: "sheet", slot: "reference-2" },
    ],
  );
  // A first-frame video model keeps its frame alone.
  const frames = {
    ...subjects,
    mediaInputs: [{ id: "reference", role: "start" }],
  };
  assert.equal(run("She dances", { profile: frames })[0].assetId, "own");
});

test("a character's other images follow its view in its reference stack's free places", () => {
  const card = {
    id: "chr-1",
    referenceIds: ["own", "two", "three", "four"],
    sheet: { jobId: "job", panels: [{ role: "back", referenceId: "back" }] },
  };
  const stack = (count) => ({
    kind: "image",
    editReferences: true,
    mediaInputs: Array.from({ length: count }, (_, index) => ({
      id: index ? `reference-${index + 1}` : "reference",
      role: "reference",
      ...(index ? { follows: index > 1 ? `reference-${index}` : "reference" } : {}),
    })),
  });
  const run = (references, profile, prompt = "Back view in the rain") =>
    sheetReferences({ references, prompt, cards: [card], profile }).map(
      ({ assetId, slot }) => `${assetId}@${slot}`,
    );
  const own = [{ assetId: "own", slot: "reference" }];
  assert.deepEqual(run(own, stack(10)), [
    "back@reference",
    "two@reference-2",
    "three@reference-3",
    "four@reference-4",
  ]);
  // Up to the stack's capacity, after a named reference.
  assert.deepEqual(
    run(
      [
        { assetId: "dress", slot: "reference" },
        { ...own[0], slot: "reference-2" },
      ],
      stack(3),
    ),
    ["dress@reference", "back@reference-2", "two@reference-3"],
  );
  // A slot taking several counts each place; an Identity slot of one stays alone.
  assert.deepEqual(run(own, { editReferences: true, mediaInputs: [{ id: "reference", max: 3 }] }), [
    "back@reference",
    "two@reference",
    "three@reference",
  ]);
  assert.deepEqual(
    run([{ assetId: "own", slot: "face" }], {
      mediaInputs: [{ id: "face", role: "identity" }, { id: "reference" }],
    }),
    ["back@face"],
  );
  // An img2img profile keeps its start image alone.
  assert.deepEqual(
    run(own, {
      family: "sdxl",
      mediaInputs: [{ id: "reference" }, { id: "reference-2", follows: "reference" }],
    }),
    ["back@reference"],
  );
});

test("a new character's finished portrait becomes its first image, then its sheet queues as its owner", async () => {
  const account = { userId: "artist" };
  const card = createCard(account, "characters", {
    name: "Mara",
    description: "red-haired ranger",
    age: 31,
    job: "Scout",
    portrait: { jobId: "portrait-job", sheet: true },
  });
  assert.deepEqual([card.referenceIds, card.age, card.job], [[], 31, "Scout"]);
  const admitted = [];
  const sheets = createCharacterSheets({
    admit: async (input, as) => {
      admitted.push([input.referenceAssets[0].assetId, as]);
      return { status: 200, payload: { jobId: "sheet-job" } };
    },
    profiles: async () => [
      { id: "qwen", kind: "image", family: "qwen_image_21", mediaInputs: [{ id: "image" }] },
    ],
    account: (ownerId) => ({ userId: ownerId }),
  });
  // Someone else's result of the same job id never becomes the card's.
  const result = { jobId: "portrait-job", type: "image", status: "done" };
  await sheets.completed([{ ...result, id: "theirs", ownerId: "other" }]);
  await sheets.completed([{ ...result, id: "portrait-1", ownerId: "artist" }]);
  const [kept] = listCards("characters", "artist");
  assert.deepEqual(kept.referenceIds, ["portrait-1"]);
  assert.equal(kept.portrait, undefined);
  assert.equal(kept.sheet.jobId, "sheet-job");
  assert.deepEqual(admitted, [["portrait-1", account]]);
});

test("a character's lead names its reference images in the plural when the run sends several", () => {
  const card = { referenceIds: ["own", "two"], description: "red hair" };
  const prompt = `${characterLead(card.description)} At a café table.`;
  const run = (references) => characterPrompt({ prompt, references, cards: [card] });
  assert.equal(run([{ assetId: "own", slot: "reference" }]), prompt);
  assert.equal(
    run([
      { assetId: "own", slot: "reference" },
      { assetId: "two", slot: "reference-2" },
    ]),
    "The person from the reference images, red hair, with the same face, hair and build. At a café table.",
  );
});
