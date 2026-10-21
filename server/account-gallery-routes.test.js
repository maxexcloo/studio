import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-account-gallery-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_MULTI_USER = "1";
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
    status() { return this; },
    json(value) { this.body = value; return this; }
  };
  handler(req, res);
  return res.body;
}

const item = (ownerId, jobId) => ({
  id: `${jobId}-0`, ownerId, jobId, index: 0, type: "image", status: "done",
  prompt: `private prompt for ${ownerId}`, model: "test-model", createdAt: "2026-10-19T00:00:00.000Z",
  url: `/files/${jobId}.png`, filename: `${jobId}.png`
});

test("gallery pages and exact job reads return only the signed-in account's records", () => {
  const first = item("account-a", "job-a");
  const second = item("account-b", "job-b");
  galleryStore.setGallery([first, second]);
  const request = { studioAccount: { userId: "account-a", role: "user", authenticated: true, features: { gallery: true } }, query: {} };

  const page = call(routes["/api/gallery"], request);
  assert.deepEqual(page.items.map((record) => record.id), [first.id]);
  assert.deepEqual(page.outputs.map((record) => record.id), [first.id]);
  assert.deepEqual(call(routes["/api/gallery/jobs/:id"], { ...request, params: { id: "job-b" } }).items, []);
  assert.deepEqual(call(routes["/api/gallery/jobs/:id"], { ...request, params: { id: "job-a" } }).items.map((record) => record.jobId), ["job-a"]);
});

test("access profiles without gallery permission cannot read pages or exact job outputs", () => {
  galleryStore.setGallery([item("account-a", "job-a")]);
  const request = { studioAccount: { userId: "account-a", role: "user", authenticated: true, generationProfiles: [], features: { gallery: false } }, query: {} };
  assert.deepEqual(call(routes["/api/gallery"], request).items, []);
  assert.deepEqual(call(routes["/api/gallery/jobs/:id"], { ...request, params: { id: "job-a" } }).items, []);
});

test("account deltas carry only the owner's own upserts and removes", () => {
  galleryStore.setGallery([item("account-a", "job-a"), item("account-b", "job-b")]);
  const request = (since) => ({ studioAccount: { userId: "account-a", role: "user", authenticated: true, features: { gallery: true } }, query: { since: String(since) } });
  const start = galleryStore.galleryRevisionValue();
  galleryStore.setGallery([item("account-a", "job-a"), item("account-b", "job-b2")]);
  const foreignOnly = call(routes["/api/gallery/delta"], request(start));
  assert.equal(foreignOnly.reset, false);
  assert.deepEqual(foreignOnly.upserts, []);
  assert.deepEqual(foreignOnly.removes, []);

  const next = galleryStore.galleryRevisionValue();
  galleryStore.setGallery([item("account-a", "job-a2"), item("account-b", "job-b2")]);
  const own = call(routes["/api/gallery/delta"], request(next));
  assert.deepEqual(own.upserts.map((record) => record.jobId), ["job-a2"]);
  assert.deepEqual(own.removes, [galleryStore.galleryKey(item("account-a", "job-a"))]);
});

test("finished outputs keep the pending tiles' owner and never replace another owner's tiles", async () => {
  const pending = (ownerId) => ({ ...item(ownerId, "shared-job"), id: `pending-${ownerId}`, url: "", status: "pending" });
  galleryStore.setGallery([pending("account-a"), pending("account-b")]);
  const jobs = new Map([["shared-job", { ownerId: "account-a", startedAt: Date.now() }]]);
  const [done] = await galleryStore.replaceGalleryJob("shared-job", [{ type: "image", url: "/files/finished-a.png", filename: "finished-a.png" }], { prompt: "a", ownerId: "account-a" }, jobs);
  assert.equal(done.ownerId, "account-a");
  const remaining = galleryStore.gallery.filter((record) => record.jobId === "shared-job");
  assert.deepEqual(remaining.map((record) => record.ownerId).sort(), ["account-a", "account-b"]);
  assert.equal(remaining.find((record) => record.ownerId === "account-b").status, "pending");
});

test("repeated gallery filters match any of their values and combine across filters", () => {
  const made = (jobId, model, width, height) => ({ ...item("account-a", jobId), model, width, height });
  galleryStore.setGallery([made("job-flux", "flux.safetensors", 1024, 1024), made("job-sdxl", "sdxl.safetensors", 1344, 768), made("job-wan", "wan.safetensors", 1024, 1024)]);
  const request = (query) => ({ studioAccount: { userId: "account-a", role: "user", authenticated: true, features: { gallery: true } }, query });
  const ids = (query) => call(routes["/api/gallery"], request({ limit: "50", ...query })).items.map((record) => record.jobId).sort();
  assert.deepEqual(ids({ model: ["flux", "sdxl"] }), ["job-flux", "job-sdxl"]);
  assert.deepEqual(ids({ model: "wan" }), ["job-wan"]);
  assert.deepEqual(ids({ model: ["flux", "sdxl"], aspect: ["1:1", "9:16"] }), ["job-flux"]);
  assert.deepEqual(ids({ model: ["", ""] }), ["job-flux", "job-sdxl", "job-wan"], "blank values are no filter");
  const since = galleryStore.galleryRevisionValue();
  galleryStore.setGallery([...galleryStore.gallery, made("job-flux2", "flux.safetensors", 2048, 2048), made("job-wan2", "wan.safetensors", 2048, 2048)]);
  const delta = call(routes["/api/gallery/delta"], request({ since: String(since), model: ["flux", "sdxl"] }));
  assert.deepEqual(delta.upserts.map((record) => record.jobId), ["job-flux2"]);
});
