import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A stand-in ComfyUI worker: /view serves outputs; the Studio worker node records deletes.
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const deletes = [];
const served = [];
const comfy = http.createServer((req, res) => {
  const url = new URL(req.url, "http://comfy.test");
  if (url.pathname === "/view") {
    served.push(url.searchParams.toString());
    if (url.searchParams.get("filename") === "missing.png") { res.writeHead(404).end("gone"); return; }
    res.writeHead(200, { "content-type": "image/png" }).end(png);
    return;
  }
  if (url.pathname === "/studio/worker/delete" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      deletes.push({ token: req.headers["x-studio-worker-token"], files: JSON.parse(body).files });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, deleted: JSON.parse(body).files.length }));
    });
    return;
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => comfy.listen(0, "127.0.0.1", resolve));

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-media-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_OUTPUT_STORAGE = "studio";
process.env.COMFY_OUTPUT_DIR = path.join(temporary, "comfy-output");
process.env.STUDIO_WORKER_TOKEN = "worker-secret";
process.env.COMFY_URL = `http://127.0.0.1:${comfy.address().port}`;
const media = await import("./media-store.js");
const paths = await import("./media-paths.js");
const { localOutputFile } = await import("./comfy.js");
const store = await import("./gallery-store.js");
const { accountOutputSubfolder } = await import("./account-ownership.js");
test.after(() => { comfy.close(); fs.rmSync(temporary, { recursive: true, force: true }); });

const comfyOutput = (filename, subfolder = "heiss-ui") => ({ type: "image", url: `/comfy/view?${new URLSearchParams({ filename, subfolder, type: "output" })}`, filename });

test("finished outputs move into the owner's HEISS media folder and leave ComfyUI", async () => {
  const { results, comfyFiles } = await media.ingestRunResults([
    { output: comfyOutput("image_00001_.png", "heiss-ui/accounts/x"), upscale: comfyOutput("upscale_00001_.png", "heiss-ui/accounts/x") },
    { output: comfyOutput("missing.png") }
  ], "account-a");
  const moved = paths.mediaParams(results[0].output.url);
  assert.equal(moved.subfolder, accountOutputSubfolder("account-a"));
  assert.match(moved.filename, /-image_00001_\.png$/);
  assert.deepEqual(fs.readFileSync(localOutputFile(moved.filename, moved.subfolder, "media")), png);
  assert.ok(paths.isMediaUrl(results[0].upscale.url));
  assert.match(results[0].output.thumbnailUrl, /^\/comfy\/thumb\?.*type=media/);
  // A fetch failure keeps ComfyUI's copy and address, so nothing is lost.
  assert.equal(results[1].output.url, comfyOutput("missing.png").url);
  assert.deepEqual(comfyFiles.map((file) => file.filename), ["image_00001_.png", "upscale_00001_.png"]);

  await media.removeComfyFiles([...comfyFiles, ...media.temporaryInputFiles({ referenceAssets: [{ temporary: true, comfyName: "heiss-ui/ref-1.png" }, { comfyName: "shared.png" }] })]);
  assert.equal(deletes.at(-1).token, "worker-secret");
  assert.deepEqual(deletes.at(-1).files.map((file) => [file.type, file.subfolder, file.filename]), [
    ["output", "heiss-ui/accounts/x", "image_00001_.png"], ["output", "heiss-ui/accounts/x", "upscale_00001_.png"], ["input", "heiss-ui", "ref-1.png"]
  ]);
});

test("media files are visible, deletable and confined to the media folder", async () => {
  const { results } = await media.ingestRunResults([{ output: comfyOutput("image_00002_.png") }], "");
  const item = { ...results[0].output, id: results[0].output.url, status: "done", jobId: "job-media", index: 0 };
  assert.equal(paths.mediaParams(item.url).subfolder, "heiss-ui");
  assert.equal(store.hasExistingOutputFile(item), true);
  assert.equal(store.deleteGalleryFiles([item]).deleted, 1);
  assert.equal(paths.mediaFile(paths.mediaParams(item.url).filename, "heiss-ui"), null);
  for (const [filename, subfolder] of [["../escape.png", ""], ["a.png", "../.."], ["a.png", ".heiss-trash"], ["notes.txt", ""]]) {
    assert.equal(paths.mediaPath(filename, subfolder), null, `${subfolder}/${filename}`);
  }
});

test("recovered history records move into media and keep their titles", async () => {
  const record = { ...comfyOutput("image_00003_.png"), id: comfyOutput("image_00003_.png").url, filename: "A quiet harbour", ownerId: "account-b", jobId: "j", index: 0, status: "done" };
  const { records, comfyFiles } = await media.ingestRecords([record]);
  assert.equal(records[0].filename, "A quiet harbour");
  assert.equal(records[0].id, records[0].url);
  assert.equal(paths.mediaParams(records[0].url).subfolder, accountOutputSubfolder("account-b"));
  assert.equal(comfyFiles.length, 1);
});

test("clearing a gallery that mixes HEISS media and older ComfyUI outputs trashes and restores both", async () => {
  const trash = await import("./gallery-trash.js");
  const { results } = await media.ingestRunResults([{ output: comfyOutput("image_00009_.png") }], "");
  const mediaItem = { ...results[0].output, id: results[0].output.url, status: "done" };
  fs.mkdirSync(path.join(process.env.COMFY_OUTPUT_DIR, "heiss-ui"), { recursive: true });
  fs.writeFileSync(path.join(process.env.COMFY_OUTPUT_DIR, "heiss-ui", "old_00001_.png"), "old");
  const oldItem = { ...comfyOutput("old_00001_.png"), id: comfyOutput("old_00001_.png").url, status: "done" };
  const result = trash.trashGalleryItems([mediaItem, oldItem]);
  assert.equal(result.moved, 2);
  assert.equal(result.batch.split(",").length, 2);
  assert.equal(trash.trashSummary().batches, 2);
  assert.equal(fs.existsSync(path.join(process.env.COMFY_OUTPUT_DIR, "heiss-ui", "old_00001_.png")), false);
  const restored = trash.restoreTrash(result.batch);
  assert.equal(restored.restored.length, 2);
  assert.equal(fs.existsSync(path.join(process.env.COMFY_OUTPUT_DIR, "heiss-ui", "old_00001_.png")), true);
  assert.ok(localOutputFile(paths.mediaParams(mediaItem.url).filename, "heiss-ui", "media"));
});

test("ingested runs are remembered across restarts so recovery never imports them twice", async () => {
  assert.equal(media.wasIngested("job-remembered"), false);
  media.noteIngested(["job-remembered"]);
  assert.equal(media.wasIngested("job-remembered"), true);
  const saved = JSON.parse(fs.readFileSync(path.join(temporary, "media-ingested.json"), "utf8"));
  assert.ok(saved.jobs["job-remembered"]);
});

test("output storage accepts studio or comfy and refuses anything else", () => {
  assert.equal(paths.outputStorageFromEnv({ STUDIO_OUTPUT_STORAGE: "studio" }), true);
  assert.equal(paths.outputStorageFromEnv({ STUDIO_OUTPUT_STORAGE: "comfy", STUDIO_MULTI_USER: "1" }), false);
  assert.equal(paths.outputStorageFromEnv({ STUDIO_MULTI_USER: "1" }), true);
  assert.equal(paths.outputStorageFromEnv({}), false);
  assert.throws(() => paths.outputStorageFromEnv({ STUDIO_OUTPUT_STORAGE: "heiss" }), /STUDIO_OUTPUT_STORAGE must be "studio" or "comfy"/);
});
