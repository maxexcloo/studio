import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { sheetView } from "../shared/characters.ts";
import { sheetPanels, sheetProfile, sheetReferences } from "./character-sheets.js";

/** A sheet drawn to prompt-sheet.js's layout: boxes of colour on a light grey background. */
async function drawnSheet({ gear = true, touching = false } = {}) {
  const box = (left, top, width, height) => ({
    input: { create: { width, height, channels: 3, background: "#7a4b2e" } },
    left,
    top,
  });
  const boxes = [
    // The face column: four close-ups.
    ...[0, 1, 2, 3].map((index) => box(60, 40 + index * 310, 260, touching ? 310 : 260)),
    // The turnaround: front, side and back.
    box(520, 60, 300, (gear ? 760 : 1160) - 60),
    box(1000, 70, 220, (gear ? 760 : 1160) - 70),
    box(1400, 60, 300, (gear ? 760 : 1160) - 60),
  ];
  if (gear) boxes.push(box(500, 920, 200, 260), box(800, 960, 300, 180), box(1300, 940, 160, 220));
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

test("a sheet is cut into its face, three views and gear by the background between them", async () => {
  const panels = await sheetPanels(await drawnSheet());
  const byRole = Object.fromEntries(panels.map((panel) => [panel.role, panel]));
  assert.deepEqual(Object.keys(byRole).sort(), ["back", "face", "front", "gear", "side"]);
  // Each holds its drawing, and no neighbour's.
  assert.ok(within(byRole.face, 60, 40, 320, 300));
  assert.ok(byRole.face.top + byRole.face.height < 350);
  assert.ok(within(byRole.front, 520, 60, 820, 760));
  assert.ok(byRole.front.left + byRole.front.width < 1000);
  assert.ok(within(byRole.side, 1000, 70, 1220, 760));
  assert.ok(within(byRole.back, 1400, 60, 1700, 760));
  assert.ok(byRole.back.top + byRole.back.height < 920);
  assert.ok(within(byRole.gear, 500, 920, 1460, 1180));
});

test("close-ups stacked without gaps give the top quarter of the column as the face", async () => {
  const face = (await sheetPanels(await drawnSheet({ touching: true }))).find(
    (panel) => panel.role === "face",
  );
  assert.ok(within(face, 60, 40, 320, 340));
  assert.ok(face.top + face.height <= 360);
});

test("without gear the turnaround takes the full height", async () => {
  const panels = await sheetPanels(await drawnSheet({ gear: false }));
  assert.deepEqual(panels.map((panel) => panel.role).sort(), ["back", "face", "front", "side"]);
  assert.ok(
    within(
      panels.find((panel) => panel.role === "front"),
      520,
      60,
      820,
      1160,
    ),
  );
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
