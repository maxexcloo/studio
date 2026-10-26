import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gallery-job-"));
process.env.STUDIO_DATA_DIR = dir;
process.env.COMFY_OUTPUT_DIR = dir;
const { setGallery } = await import("./gallery-store.js");
const { registerGalleryReadRoutes } = await import("./gallery-routes.js");

test("exact job results exclude unrelated and deleted outputs and expose prompts only on request", async (t) => {
  const app = express();
  registerGalleryReadRoutes(app, { jobChats: () => new Map() });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const item = (name, extra = {}) => ({
    jobId: "chosen",
    id: name,
    index: 0,
    status: "done",
    type: "image",
    url: `/comfy/view?filename=${name}`,
    prompt: "private prompt text",
    ...extra,
  });
  fs.writeFileSync(path.join(dir, "visible.png"), "fixture");
  fs.writeFileSync(path.join(dir, "unrelated.png"), "fixture");
  setGallery([
    item("visible.png"),
    item("deleted.png", { index: 1 }),
    item("unrelated.png", { jobId: "other" }),
  ]);
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/gallery/jobs/chosen`);
  const result = await response.json();
  assert.deepEqual(result.items, [
    {
      jobId: "chosen",
      index: 0,
      status: "done",
      type: "image",
      url: "/comfy/view?filename=visible.png",
    },
  ]);
  // MCP asks for the prompt and settings only to run a result again.
  const detailed = await (await fetch(`${base}/api/gallery/jobs/chosen?settings=1`)).json();
  assert.deepEqual(
    detailed.items.map(({ index, prompt }) => ({ index, prompt })),
    [{ index: 0, prompt: "private prompt text" }],
  );
  assert.deepEqual(await (await fetch(`${base}/api/gallery/jobs/missing`)).json(), { items: [] });
  setGallery([]);
  assert.deepEqual(await (await fetch(`${base}/api/gallery/jobs/chosen`)).json(), { items: [] });
});
