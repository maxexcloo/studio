import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-account-gallery-"));
process.env.HEISS_DATA_DIR = temporary;
process.env.HEISS_MULTI_USER = "1";
process.env.COMFY_URL = "http://127.0.0.1:9";
const [{ registerGalleryReadRoutes }, galleryStore] = await Promise.all([
  import("./gallery-routes.js"),
  import("./gallery-store.js")
]);

const routes = {};
registerGalleryReadRoutes({ get: (route, handler) => { routes[route] = handler; } });

function call(handler, req) {
  const res = {
    body: null,
    json(value) { this.body = value; return this; }
  };
  handler(req, res);
  return res.body;
}

const item = (ownerId, jobId) => ({
  id: `${jobId}-0`, ownerId, jobId, index: 0, type: "image", status: "done",
  prompt: `private prompt for ${ownerId}`, model: "test-model", createdAt: new Date().toISOString(),
  url: `/files/${jobId}.png`, filename: `${jobId}.png`
});

test("gallery pages and exact job reads return only the signed-in account's records", () => {
  const first = item("account-a", "job-a");
  const second = item("account-b", "job-b");
  galleryStore.setGallery([first, second]);
  const request = { heissAccount: { userId: "account-a", role: "user" }, query: {} };

  const page = call(routes["/api/gallery"], request);
  assert.deepEqual(page.items.map((record) => record.id), [first.id]);
  assert.deepEqual(page.outputs.map((record) => record.id), [first.id]);
  assert.deepEqual(call(routes["/api/gallery/jobs/:id"], { ...request, params: { id: "job-b" } }).items, []);
  assert.deepEqual(call(routes["/api/gallery/jobs/:id"], { ...request, params: { id: "job-a" } }).items.map((record) => record.jobId), ["job-a"]);
});
