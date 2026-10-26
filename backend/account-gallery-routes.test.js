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
  import("./gallery-store.js"),
]);

const routes = {};
const jobChats = new Map();
registerGalleryReadRoutes(
  {
    get: (route, handler) => {
      routes[route] = handler;
    },
  },
  { jobChats: () => jobChats },
);

function call(handler, req) {
  const res = {
    body: null,
    status() {
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  handler(req, res);
  return res.body;
}

const item = (ownerId, jobId) => ({
  id: `${jobId}-0`,
  ownerId,
  jobId,
  index: 0,
  type: "image",
  status: "done",
  prompt: `private prompt for ${ownerId}`,
  model: "test-model",
  createdAt: "2026-10-19T00:00:00.000Z",
  url: `/files/${jobId}.png`,
  filename: `${jobId}.png`,
});

test("gallery pages and exact job reads return only the signed-in account's records", () => {
  const first = item("account-a", "job-a");
  const second = item("account-b", "job-b");
  galleryStore.setGallery([first, second]);
  const request = {
    studioAccount: {
      userId: "account-a",
      role: "user",
      authenticated: true,
      features: { gallery: true },
    },
    query: {},
  };

  const page = call(routes["/api/gallery"], request);
  assert.deepEqual(
    page.items.map((record) => record.id),
    [first.id],
  );
  assert.deepEqual(
    page.outputs.map((record) => record.id),
    [first.id],
  );
  assert.deepEqual(
    call(routes["/api/gallery/jobs/:id"], { ...request, params: { id: "job-b" } }).items,
    [],
  );
  assert.deepEqual(
    call(routes["/api/gallery/jobs/:id"], { ...request, params: { id: "job-a" } }).items.map(
      (record) => record.jobId,
    ),
    ["job-a"],
  );
});

test("access profiles without gallery permission cannot read pages or exact job outputs", () => {
  galleryStore.setGallery([item("account-a", "job-a")]);
  const request = {
    studioAccount: {
      userId: "account-a",
      role: "user",
      authenticated: true,
      generationProfiles: [],
      features: { gallery: false },
    },
    query: {},
  };
  assert.deepEqual(call(routes["/api/gallery"], request).items, []);
  assert.deepEqual(
    call(routes["/api/gallery/jobs/:id"], { ...request, params: { id: "job-a" } }).items,
    [],
  );
});

test("LoRA previews use the account's newest finished image made with each LoRA", () => {
  const made = (ownerId, jobId, createdAt, loras, status = "done") => ({
    ...item(ownerId, jobId),
    status,
    createdAt,
    thumbnailUrl: `/thumbs/${jobId}.webp`,
    settings: { loras },
  });
  const detail = { name: "detail.safetensors", strength: 1 };
  galleryStore.setGallery([
    made("account-a", "old", "2026-10-18T00:00:00.000Z", [detail]),
    made("account-a", "new", "2026-10-19T00:00:00.000Z", [detail]),
    made("account-a", "off", "2026-10-20T00:00:00.000Z", [{ ...detail, enabled: false }]),
    made("account-a", "failed", "2026-10-21T00:00:00.000Z", [detail], "error"),
    made("account-b", "foreign", "2026-10-22T00:00:00.000Z", [
      detail,
      { name: "private.safetensors" },
    ]),
  ]);
  const request = {
    studioAccount: {
      userId: "account-a",
      role: "user",
      authenticated: true,
      features: { gallery: true },
    },
    query: {},
  };
  assert.deepEqual(call(routes["/api/loras/previews"], request).previews, {
    "detail.safetensors": "/thumbs/new.webp",
  });
});

test("account deltas carry only the owner's own upserts and removes", () => {
  galleryStore.setGallery([item("account-a", "job-a"), item("account-b", "job-b")]);
  const request = (since) => ({
    studioAccount: {
      userId: "account-a",
      role: "user",
      authenticated: true,
      features: { gallery: true },
    },
    query: { since: String(since) },
  });
  const start = galleryStore.galleryRevisionValue();
  galleryStore.setGallery([item("account-a", "job-a"), item("account-b", "job-b2")]);
  const foreignOnly = call(routes["/api/gallery/delta"], request(start));
  assert.equal(foreignOnly.reset, false);
  assert.deepEqual(foreignOnly.upserts, []);
  assert.deepEqual(foreignOnly.removes, []);

  const next = galleryStore.galleryRevisionValue();
  galleryStore.setGallery([item("account-a", "job-a2"), item("account-b", "job-b2")]);
  const own = call(routes["/api/gallery/delta"], request(next));
  assert.deepEqual(
    own.upserts.map((record) => record.jobId),
    ["job-a2"],
  );
  assert.deepEqual(own.removes, [galleryStore.galleryKey(item("account-a", "job-a"))]);
});

test("finished outputs keep the pending tiles' owner and never replace another owner's tiles", async () => {
  const pending = (ownerId) => ({
    ...item(ownerId, "shared-job"),
    id: `pending-${ownerId}`,
    url: "",
    status: "pending",
  });
  galleryStore.setGallery([pending("account-a"), pending("account-b")]);
  const jobs = new Map([["shared-job", { ownerId: "account-a", startedAt: Date.now() }]]);
  const [done] = await galleryStore.replaceGalleryJob(
    "shared-job",
    [{ type: "image", url: "/files/finished-a.png", filename: "finished-a.png" }],
    { prompt: "a", ownerId: "account-a" },
    jobs,
  );
  assert.equal(done.ownerId, "account-a");
  const remaining = galleryStore.gallery.filter((record) => record.jobId === "shared-job");
  assert.deepEqual(remaining.map((record) => record.ownerId).sort(), ["account-a", "account-b"]);
  assert.equal(remaining.find((record) => record.ownerId === "account-b").status, "pending");
});

test("repeated gallery filters match any of their values and combine across filters", () => {
  const made = (jobId, model, width, height) => ({
    ...item("account-a", jobId),
    model,
    width,
    height,
  });
  galleryStore.setGallery([
    made("job-flux", "flux.safetensors", 1024, 1024),
    made("job-sdxl", "sdxl.safetensors", 1344, 768),
    made("job-wan", "wan.safetensors", 1024, 1024),
  ]);
  const request = (query) => ({
    studioAccount: {
      userId: "account-a",
      role: "user",
      authenticated: true,
      features: { gallery: true },
    },
    query,
  });
  const ids = (query) =>
    call(routes["/api/gallery"], request({ limit: "50", ...query }))
      .items.map((record) => record.jobId)
      .sort();
  assert.deepEqual(ids({ model: ["flux", "sdxl"] }), ["job-flux", "job-sdxl"]);
  assert.deepEqual(ids({ model: "wan" }), ["job-wan"]);
  assert.deepEqual(ids({ model: ["flux", "sdxl"], aspect: ["1:1", "9:16"] }), ["job-flux"]);
  assert.deepEqual(
    ids({ model: ["", ""] }),
    ["job-flux", "job-sdxl", "job-wan"],
    "blank values are no filter",
  );
  const since = galleryStore.galleryRevisionValue();
  galleryStore.setGallery([
    ...galleryStore.gallery,
    made("job-flux2", "flux.safetensors", 2048, 2048),
    made("job-wan2", "wan.safetensors", 2048, 2048),
  ]);
  const delta = call(
    routes["/api/gallery/delta"],
    request({ since: String(since), model: ["flux", "sdxl"] }),
  );
  assert.deepEqual(
    delta.upserts.map((record) => record.jobId),
    ["job-flux2"],
  );
});

test("gallery filter options cover the owned gallery without exposing other accounts or media kinds", () => {
  galleryStore.setGallery([
    ...Array.from({ length: 65 }, (_, index) => ({
      ...item("account-a", `page-${index}`),
      model: "shared-model",
    })),
    {
      ...item("account-a", "last-page"),
      model: "late-model",
      settings: { modelName: "base-model", loras: [{ name: "detail.safetensors" }] },
    },
    {
      ...item("account-b", "private"),
      model: "private-model",
      settings: { loras: [{ name: "private-lora" }] },
    },
    { ...item("account-a", "video"), type: "video", model: "video-model" },
  ]);
  const request = {
    studioAccount: {
      userId: "account-a",
      role: "user",
      authenticated: true,
      features: { gallery: true },
    },
    query: { type: "image", limit: "60", q: "no-match" },
  };
  const facets = call(routes["/api/gallery/filters"], request);
  assert.deepEqual(facets.models, ["base-model", "late-model", "shared-model"]);
  assert.deepEqual(facets.loras, ["detail.safetensors"]);
  assert.equal(facets.sizes[0].value, "up-to-1k");
  assert.equal(facets.aspects.at(-1).value, "other");
  assert.deepEqual(
    call(routes["/api/gallery/filters"], {
      ...request,
      studioAccount: { ...request.studioAccount, features: { gallery: false } },
    }),
    { ok: false, error: "Gallery access is disabled for this account." },
  );
});

test("gallery items carry their Chat, which filters pages and lists as a facet", () => {
  galleryStore.setGallery([item("account-a", "job-a"), item("account-a", "job-b")]);
  jobChats.set("job-a", { id: "chat-a", title: "Teapots" });
  const request = (query) => ({
    studioAccount: {
      userId: "account-a",
      role: "user",
      authenticated: true,
      features: { gallery: true },
    },
    query,
  });
  try {
    const page = call(routes["/api/gallery"], request({ limit: "50" }));
    assert.deepEqual(page.items.map((record) => [record.jobId, record.sessionId]).sort(), [
      ["job-a", "chat-a"],
      ["job-b", undefined],
    ]);
    assert.deepEqual(
      call(routes["/api/gallery"], request({ limit: "50", chat: "chat-a" })).items.map(
        (record) => record.jobId,
      ),
      ["job-a"],
    );
    assert.deepEqual(call(routes["/api/gallery/filters"], request({})).chats, [
      { value: "chat-a", label: "Teapots" },
    ]);
  } finally {
    jobChats.clear();
  }
});

test("search matches an image's caption as well as its prompt, within the account's own records", () => {
  const caption = (text, tags = []) => ({
    text,
    tags,
    model: "vision-model",
    at: "2026-10-26T09:00:00.000Z",
    version: 2,
  });
  galleryStore.setGallery([
    {
      ...item("account-a", "job-fox"),
      caption: caption("A red fox in deep snow at dusk.", ["wildlife", "winter scene"]),
    },
    { ...item("account-a", "job-plain"), prompt: "red fox portrait" },
    { ...item("account-b", "job-other"), caption: caption("A red fox in the snow.") },
  ]);
  const ids = (q) =>
    call(routes["/api/gallery"], {
      studioAccount: {
        userId: "account-a",
        role: "user",
        authenticated: true,
        features: { gallery: true },
      },
      query: { q },
    })
      .items.map((record) => record.jobId)
      .sort();
  assert.deepEqual(ids("Fox SNOW"), ["job-fox"]);
  assert.deepEqual(ids("red fox"), ["job-fox", "job-plain"]);
  assert.deepEqual(ids("dusk private"), ["job-fox"], "words may come from caption and prompt");
  assert.deepEqual(ids("winter wildlife"), ["job-fox"], "and from the caption's tags");
});
