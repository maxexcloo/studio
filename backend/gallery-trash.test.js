import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-trash-"));
const outputDir = path.join(temporary, "ComfyUI", "output");
fs.mkdirSync(outputDir, { recursive: true });
process.env.STUDIO_DATA_DIR = path.join(temporary, "data");
process.env.STUDIO_COMFY_OUTPUT_DIR = outputDir;
process.env.STUDIO_WORKERS = JSON.stringify([
  {
    id: "primary",
    url: "http://127.0.0.1:9",
    capabilities: ["image", "video", "upscale", "models"],
  },
]);

const trash = await import("./gallery-trash.js");
const { trashFolderName } = await import("./data-names.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test("old trash batches are purged after the retention, and the trash folder stays", async () => {
  const dir = path.join(outputDir, trashFolderName, "batch-1");
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  fs.writeFileSync(path.join(dir, "files", "image_00001_.png"), "one");
  fs.writeFileSync(
    path.join(dir, "batch.json"),
    JSON.stringify({ version: 1, createdAt: new Date().toISOString(), items: [], files: ["x"] }),
  );
  const later = Date.now() + (trash.trashDays + 1) * 24 * 60 * 60 * 1000;
  assert.equal(await trash.purgeTrash({ now: Date.now() }), 0, "nothing is old yet");
  assert.equal(await trash.purgeTrash({ now: later }), 1);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.existsSync(path.join(outputDir, trashFolderName)), true);
});
