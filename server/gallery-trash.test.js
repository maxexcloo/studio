import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-trash-"));
const outputDir = path.join(temporary, "ComfyUI", "output");
fs.mkdirSync(path.join(outputDir, "heiss-ui"), { recursive: true });
process.env.HEISS_DATA_DIR = path.join(temporary, "data");
process.env.COMFY_OUTPUT_DIR = outputDir;
process.env.COMFY_URL = "http://127.0.0.1:9";

const trash = await import("./gallery-trash.js");
const { accountOutputSubfolder } = await import("./account-ownership.js");

const item = (filename, extra = {}) => ({
  id: `/comfy/view?${new URLSearchParams({ filename, subfolder: "heiss-ui", type: "output" })}`,
  url: `/comfy/view?${new URLSearchParams({ filename, subfolder: "heiss-ui", type: "output" })}`,
  status: "done",
  filename: "a prompt",
  outputName: filename,
  createdAt: new Date().toISOString(),
  ...extra
});
const file = (name) => path.join(outputDir, "heiss-ui", name);

test("clearing moves the files into a trash batch, upscales too, and Undo puts them back", () => {
  fs.writeFileSync(file("image_00001_.png"), "one");
  fs.writeFileSync(file("image_00002_.png"), "two");
  fs.writeFileSync(file("upscale_00001_.png"), "big");
  const items = [item("image_00001_.png", { upscale: { status: "done", url: `/comfy/view?${new URLSearchParams({ filename: "upscale_00001_.png", subfolder: "heiss-ui", type: "output" })}` } }), item("image_00002_.png")];
  const result = trash.trashGalleryItems(items);
  assert.equal(result.moved, 3);
  assert.ok(result.batch);
  assert.equal(fs.existsSync(file("image_00001_.png")), false);
  assert.equal(fs.existsSync(file("upscale_00001_.png")), false);
  assert.equal(trash.trashSummary().items, 2);

  const { restored, missing } = trash.restoreTrash(result.batch);
  assert.equal(missing, 0);
  assert.deepEqual(restored.map((entry) => entry.outputName).sort(), ["image_00001_.png", "image_00002_.png"]);
  assert.equal(fs.readFileSync(file("image_00001_.png"), "utf8"), "one");
  assert.equal(fs.readFileSync(file("upscale_00001_.png"), "utf8"), "big");
  assert.equal(trash.trashSummary().batches, 0, "an emptied batch goes");
});

test("a file whose name is taken again stays in the trash instead of overwriting the new one", () => {
  fs.writeFileSync(file("image_00003_.png"), "old");
  const { batch } = trash.trashGalleryItems([item("image_00003_.png")]);
  fs.writeFileSync(file("image_00003_.png"), "new");
  const { restored, missing } = trash.restoreTrash(batch);
  assert.equal(restored.length, 0);
  assert.equal(missing, 1);
  assert.equal(fs.readFileSync(file("image_00003_.png"), "utf8"), "new");
  assert.equal(trash.trashSummary().files, 1);
});

test("account trash summaries and restore operations stay within the selected owner", async () => {
  const ownerA = "account-a";
  const ownerB = "account-b";
  const subfolderA = accountOutputSubfolder(ownerA);
  const subfolderB = accountOutputSubfolder(ownerB);
  const ownedItem = (ownerId, subfolder, filename) => {
    const url = `/comfy/view?${new URLSearchParams({ filename, subfolder, type: "output" })}`;
    return item(filename, { id: url, url, ownerId });
  };
  for (const subfolder of [subfolderA, subfolderB]) fs.mkdirSync(path.join(outputDir, subfolder), { recursive: true });
  const itemA = ownedItem(ownerA, subfolderA, "account-a.png");
  const itemB = ownedItem(ownerB, subfolderB, "account-b.png");
  fs.writeFileSync(path.join(outputDir, subfolderA, "account-a.png"), "a");
  fs.writeFileSync(path.join(outputDir, subfolderB, "account-b.png"), "b");
  const batchA = trash.trashGalleryItems([itemA]).batch;
  const batchB = trash.trashGalleryItems([itemB]).batch;

  assert.equal(trash.trashSummary(undefined, ownerA).items, 1);
  assert.equal(trash.trashSummary(undefined, ownerB).items, 1);
  assert.equal(trash.trashSummary(undefined, "unknown-owner").items, 0);
  assert.deepEqual(trash.restoreTrash(batchB, undefined, ownerA), { restored: [], missing: 0 });
  assert.equal(trash.restoreTrash(batchA, undefined, ownerA).restored[0].ownerId, ownerA);
  assert.equal(await trash.emptyTrash(undefined, ownerB), 1);
  assert.equal(trash.trashSummary(undefined, ownerA).batches, 0);
  assert.equal(trash.trashSummary(undefined, ownerB).batches, 0);
});

test("nothing outside the output folder is touched, and old batches are purged after the retention", async () => {
  const outside = path.join(temporary, "outside.png");
  fs.writeFileSync(outside, "keep");
  const escaping = { id: "x", url: `/comfy/view?${new URLSearchParams({ filename: "outside.png", subfolder: "../..", type: "output" })}`, status: "done" };
  assert.equal(trash.trashGalleryItems([escaping]).moved, 0);
  assert.equal(fs.readFileSync(outside, "utf8"), "keep");

  const later = Date.now() + (trash.trashDays + 1) * 24 * 60 * 60 * 1000;
  assert.ok(trash.trashSummary().batches >= 1);
  assert.equal(await trash.purgeTrash({ now: Date.now() }), 0, "nothing is old yet");
  assert.ok(await trash.purgeTrash({ now: later }) >= 1);
  assert.equal(trash.trashSummary().batches, 0);
  assert.equal(fs.existsSync(path.join(outputDir, trash.trashFolderName)), true, "the trash folder itself stays");
});
