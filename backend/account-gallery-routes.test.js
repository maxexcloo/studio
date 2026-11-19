import assert from "node:assert/strict";
import test from "node:test";

import { temporaryFolder } from "./fixtures/temporary.js";

const temporary = temporaryFolder("studio-account-gallery-");
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_MULTI_USER = "1";
process.env.STUDIO_WORKERS = JSON.stringify([
  {
    id: "primary",
    url: "http://127.0.0.1:9",
    capabilities: ["image", "video", "upscale", "models"],
  },
]);
const { openDatabase } = await import("./persistence/runtime.ts");
const { Store } = await import("./domain/store.ts");
const { saveAccountPreferences } = await import("./account-preferences.js");
const [{ registerGalleryHistoryRoutes, registerGalleryReadRoutes }, galleryStore] =
  await Promise.all([import("./gallery/routes.js"), import("./gallery/store.js")]);
const { setGallery, gallery: galleryRows } = await import("./fixtures/gallery.js");

const routes = {};
// Image search (domain/image-search.ts): a test per search, or null.
let near = () => null;
const queue = new Store(openDatabase(":memory:"));
registerGalleryReadRoutes(
  {
    get: (route, handler) => {
      routes[route] = handler;
    },
  },
  {
    near: async (q) => near(q),
    store: queue,
  },
);

async function call(handler, req) {
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
  await handler(req, res);
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

test("library review pages only the owner's eligible media in a stable seeded order", async () => {
  const own = (id, fields = {}) => ({ ...item("account-a", id), ...fields });
  const candidates = [
    own("recent", { createdAt: "2026-11-01T00:00:00Z" }),
    own("old", { type: "video", createdAt: "2024-01-01T00:00:00Z" }),
    own("kept", { dream: { state: "kept" } }),
    own("expired", { libraryReviewedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 }),
    own("without-metadata", { prompt: undefined, model: undefined }),
  ];
  setGallery([
    ...candidates,
    own("accepted", { libraryReviewedAt: Date.now() }),
    own("unseen", { dream: { state: "unseen" } }),
    own("discarded", { dream: { state: "discarded" } }),
    own("liked", { rating: "liked" }),
    own("disliked", { rating: "disliked" }),
    own("pending", { status: "pending" }),
    own("text", { type: "text" }),
    own("reference", { uploaded: true }),
    own("missing", { url: "/comfy/view?filename=missing.png&type=media" }),
    item("account-b", "other"),
  ]);
  const read = (query, studioAccount = { userId: "account-a" }) =>
    call(routes["/api/gallery/library-review"], {
      studioAccount,
      query: { seed: "first", ownerId: "account-b", ...query },
    });
  const all = await read({});
  assert.equal(all.remaining, candidates.length);
  assert.deepEqual(new Set(all.items.map(({ id }) => id)), new Set(candidates.map(({ id }) => id)));
  assert.deepEqual(await read({}), all);
  assert.notDeepEqual((await read({ seed: "second" })).items, all.items);
  assert.equal((await read({}, null)).remaining, 0);

  const videos = await read({ media: "video" });
  assert.deepEqual(
    videos.items,
    all.items.filter(({ type }) => type === "video"),
  );
  assert.equal(videos.remaining, 1);

  const images = await read({ media: "image", limit: 2 });
  const moreImages = await read({ media: "image", cursor: images.nextCursor });
  assert.equal(images.remaining, candidates.length - 1);
  assert.equal(moreImages.remaining, images.remaining - images.items.length);
  assert.deepEqual(
    [...images.items, ...moreImages.items],
    all.items.filter(({ type }) => type === "image"),
  );
  assert.ok((await read({ media: "text" })).error);

  const first = await read({ limit: 2 });
  galleryStore.setGalleryRatings([first.items[1].id], "liked", "account-a");
  const rest = await read({ cursor: first.nextCursor });
  assert.deepEqual([...first.items, ...rest.items], all.items);
  assert.equal(rest.remaining, candidates.length - first.items.length);
  assert.equal(rest.nextCursor, "");
});

test("library Accept and gallery ratings undo through their own routes", async () => {
  const media = item("account-a", "review");
  setGallery([media]);
  const handlers = {};
  const ratings = [];
  registerGalleryHistoryRoutes(
    {
      get() {},
      post: (path, handler) => {
        handlers[path] = handler;
      },
    },
    { rated: (...args) => ratings.push(args) },
  );
  const review = (reviewed, userId = media.ownerId) =>
    call(handlers["/api/gallery/library-review/:id"], {
      studioAccount: { userId },
      params: { id: media.id },
      body: { reviewed },
    });
  const page = () =>
    call(routes["/api/gallery/library-review"], {
      studioAccount: { userId: media.ownerId },
      query: { seed: "review" },
    });
  const rate = (rating) =>
    call(handlers["/api/gallery/favorite"], {
      studioAccount: { userId: media.ownerId },
      body: { ids: [media.id], rating },
    });
  assert.ok((await review(true, "account-b")).error);
  assert.equal((await page()).remaining, 1);
  assert.equal((await review(true)).ok, true);
  assert.equal((await page()).remaining, 0);
  assert.equal(galleryStore.galleryItem(media.id).rating, undefined);
  assert.equal((await review(false)).ok, true);
  assert.equal((await page()).remaining, 1);
  assert.equal(ratings.length, 0);
  assert.equal((await rate("disliked")).ok, true);
  assert.equal((await page()).remaining, 0);
  assert.equal(galleryStore.visibleGallery({ ownerId: media.ownerId }).length, 0);
  assert.equal(galleryStore.galleryItem(media.id).rating, "disliked");
  assert.equal((await rate(null)).ok, true);
  assert.equal((await page()).remaining, 1);
  assert.deepEqual(
    ratings.map(([, [change]]) => [change.was, change.rating]),
    [
      [null, "disliked"],
      ["disliked", undefined],
    ],
  );
});

test("gallery pages and exact job reads return only the signed-in account's records", async () => {
  const first = {
    ...item("account-a", "job-a"),
    writing: { kind: "request", model: "writer", thinking: "long thoughts" },
  };
  const second = item("account-b", "job-b");
  // A Dream result awaiting its verdict is listed nowhere, but a result made from it links to it.
  const dream = { ...item("account-a", "job-dream"), dream: { state: "unseen" } };
  setGallery([first, second, dream]);
  const request = {
    studioAccount: {
      userId: "account-a",
      role: "user",
      authenticated: true,
      features: {},
    },
    query: {},
  };

  const page = await call(routes["/api/gallery"], request);
  assert.deepEqual(
    page.items.map((record) => record.id),
    [first.id],
  );
  // Pages leave the prompt's thinking to Details, which reads the item itself.
  assert.deepEqual(page.items[0].writing, { kind: "request", model: "writer" });
  const read = (id) => call(routes["/api/gallery/items/:id"], { ...request, params: { id } });
  assert.equal((await read(first.id)).item.writing.thinking, "long thoughts");
  assert.equal((await read(second.id)).item, undefined);
  assert.equal((await read(dream.id)).item.id, dream.id);
  assert.deepEqual(
    (await call(routes["/api/gallery/jobs/:id"], { ...request, params: { id: "job-b" } })).items,
    [],
  );
  assert.deepEqual(
    (
      await call(routes["/api/gallery/jobs/:id"], { ...request, params: { id: "job-a" } })
    ).items.map((record) => record.jobId),
    ["job-a"],
  );
});

test("quick selection reaches older matches within the same account, search and filters", async () => {
  const ownerId = "selection-account";
  const account = { userId: ownerId, role: "user", authenticated: true, features: {} };
  const records = Array.from({ length: 1_205 }, (_, index) => ({
    ...item(ownerId, `selection-${index}`),
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    prompt: "harbour dawn",
    model: "match-model",
    status: index < 2 ? "failed" : "done",
    caption: { text: "display caption", tags: ["water"] },
  }));
  setGallery([
    ...records,
    { ...records[0], id: "another-owner", url: "", ownerId: "stranger" },
    { ...records[0], id: "wrong-model", url: "", model: "other" },
    { ...records[0], id: "wrong-prompt", url: "", prompt: "mountain" },
    { ...records[0], id: "wrong-rating", url: "", rating: "disliked" },
    { ...records[0], id: "wrong-type", url: "", type: "video" },
  ]);
  const listing = { type: "image", q: "harbour", model: "match-model", limit: "60" };
  const get = (query, studioAccount = account) =>
    call(routes["/api/gallery"], { studioAccount, query: { ...listing, ...query } });
  const first = await get({});
  assert.equal(first.items.length, 60);
  assert.equal(first.hasMore, true);
  assert.ok(first.items.every(({ status }) => status === "done"));
  const failed = await get({ select: "failed" });
  assert.deepEqual(
    failed.items.map(({ id }) => id),
    [records[1].id, records[0].id],
  );
  assert.equal(failed.hasMore, false);
  const all = await get({ select: "all" });
  assert.deepEqual(
    all.items.map(({ id }) => id),
    records.map(({ id }) => id).reverse(),
  );
  assert.equal(all.items[0].url, first.items[0].url);
  assert.equal(all.items[0].caption, undefined);
  assert.equal(all.items[0].number, undefined);
  assert.deepEqual((await get({ select: "all" }, null)).items, []);
  assert.deepEqual(await get({}), first, "quick selection leaves ordinary pagination intact");
});

test("viewer numbers resolve only the caller's output and survive its pending media ID", async () => {
  const ownerId = "viewer-account";
  const account = { userId: ownerId, role: "user", authenticated: true, features: {} };
  const request = { studioAccount: account, query: {} };
  const job = queue.enqueue(
    ownerId,
    queue.createSession(ownerId).id,
    { kind: "image", count: 2, prompt: "Viewer Result" },
    "image",
  );
  const pending = { ...item(ownerId, job.id), id: `${job.id}-1`, index: 1, status: "pending" };
  setGallery([pending]);
  const number = galleryStore.resultNumbers.numbered([pending])[0].number;
  const read = (number, studioAccount = account) =>
    call(routes["/api/gallery/results/:number"], {
      ...request,
      studioAccount,
      params: { number: String(number) },
    });
  assert.equal((await read(number)).item.id, pending.id);
  // Work not yet saved in the gallery resolves from the same owned queue output.
  setGallery([]);
  assert.equal((await read(number)).item.id, pending.id);
  // Finishing replaces the pending media ID without replacing its URL number.
  const finished = {
    ...pending,
    id: "/comfy/view?filename=finished.png&subfolder=private",
    status: "done",
  };
  setGallery([finished]);
  assert.equal((await read(number)).item.id, finished.id);
  assert.equal((await read(number)).item.number, number);
  assert.equal((await read(number, { ...account, userId: "stranger" })).item, undefined);
  const video = { ...finished, type: "video", rating: "disliked" };
  setGallery([video]);
  assert.equal((await read(number)).item.type, "video");
  assert.equal((await read(number)).item.rating, "disliked");
  assert.equal((await read(number, null)).item, undefined);
  assert.equal((await read("invalid")).item, undefined);
  assert.equal((await read(999999999)).item, undefined);
  assert.deepEqual(
    await call(routes["/api/results/:number"], { ...request, params: { number: String(number) } }),
    { jobId: job.id, index: 1 },
  );
  queue.save({ ...queue.job(ownerId, job.id), status: "completed" });
  setGallery([]);
  assert.equal((await read(number)).item, undefined);
});

test("unfinished work shows as the account chooses: none, in progress, or queued work first", async () => {
  const done = item("account-a", "job-done");
  const session = queue.createSession("account-a");
  // Started work has its tiles; waiting work has none yet.
  const started = queue.enqueue(
    "account-a",
    session.id,
    { prompt: "a hare", kind: "image" },
    "image",
  );
  const running = {
    ...item("account-a", started.id),
    status: "pending",
    createdAt: "2026-10-20T00:00:00.000Z",
  };
  setGallery([running, done]);
  const waiting = queue.enqueue(
    "account-a",
    session.id,
    { prompt: "a fox", kind: "image" },
    "image",
  );
  queue.enqueue("account-b", queue.createSession("account-b").id, { kind: "image" }, "image");
  const request = {
    studioAccount: { userId: "account-a", role: "user", authenticated: true, features: {} },
    query: {},
  };
  const shown = async () =>
    (await call(routes["/api/gallery"], request)).items.map((record) => record.id);
  assert.deepEqual(await shown(), [done.id]);
  saveAccountPreferences("account-a", { galleryWork: "running" });
  assert.deepEqual(await shown(), [running.id, done.id]);
  saveAccountPreferences("account-a", { galleryWork: "queued" });
  assert.deepEqual(await shown(), [`${waiting.id}-0`, running.id, done.id]);
  const videos = await call(routes["/api/gallery"], { ...request, query: { type: "video" } });
  assert.deepEqual(videos.items, []);
  for (const job of [started, waiting])
    queue.save({ ...queue.job("account-a", job.id), status: "cancelled" });
});

test("Clear Failed takes the account's own failed items; administrators may name an owner or all", async () => {
  const { registerGalleryErrorRoutes } = await import("./gallery/routes.js");
  const posts = {};
  registerGalleryErrorRoutes({ post: (route, handler) => (posts[route] = handler) });
  const failed = (ownerId, jobId) => ({ ...item(ownerId, jobId), status: "failed", url: "" });
  const account = (userId, role = "user") => ({
    studioAccount: { userId, role, authenticated: true, features: { gallery: true } },
  });
  const clear = (req) => call(posts["/api/gallery/errors/clear"], req);
  const left = () =>
    galleryRows()
      .map((record) => record.jobId)
      .sort();
  setGallery([
    failed("account-a", "a-failed"),
    failed("account-b", "b-failed"),
    failed("account-c", "c-failed"),
    item("account-b", "b-done"),
  ]);

  assert.equal((await clear({ ...account("account-a"), body: {} })).cleared, 1);
  assert.deepEqual(left(), ["b-done", "b-failed", "c-failed"]);
  assert.equal(
    (await clear({ ...account("account-a"), body: { owner: "all" } })).reason,
    "computer-only",
    "only administrators clear other accounts' items",
  );
  assert.equal(
    (await clear({ ...account("admin", "administrator"), body: { owner: "account-b" } })).cleared,
    1,
  );
  assert.deepEqual(left(), ["b-done", "c-failed"]);
  await clear({ ...account("admin", "administrator"), body: { owner: "all" } });
  assert.deepEqual(left(), ["b-done"]);
});

test("LoRA previews use the account's newest finished image made with each LoRA and count its uses", async () => {
  const made = (ownerId, jobId, createdAt, loras, status = "done") => ({
    ...item(ownerId, jobId),
    status,
    createdAt,
    thumbnailUrl: `/thumbs/${jobId}.webp`,
    settings: { loras },
  });
  const detail = { name: "detail.safetensors", strength: 1 };
  setGallery([
    made("account-a", "old", "2026-10-18T00:00:00.000Z", [detail]),
    made("account-a", "new", "2026-10-19T00:00:00.000Z", [detail]),
    made("account-a", "off", "2026-10-20T00:00:00.000Z", [{ ...detail, enabled: false }]),
    made("account-a", "failed", "2026-10-21T00:00:00.000Z", [detail], "failed"),
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
      features: {},
    },
    query: {},
  };
  const found = await call(routes["/api/loras/previews"], request);
  assert.deepEqual(found.previews, { "detail.safetensors": "/thumbs/new.webp" });
  assert.deepEqual(found.uses, { "detail.safetensors": 2 });
});

test("finished outputs keep the pending tiles' owner and never replace another owner's tiles", async () => {
  const pending = (ownerId) => ({
    ...item(ownerId, "shared-job"),
    id: `pending-${ownerId}`,
    url: "",
    status: "pending",
  });
  setGallery([pending("account-a"), pending("account-b")]);
  const jobs = new Map([["shared-job", { ownerId: "account-a", startedAt: Date.now() }]]);
  const [done] = await galleryStore.replaceGalleryJob(
    "shared-job",
    [{ type: "image", url: "/files/finished-a.png", filename: "finished-a.png" }],
    { prompt: "a", ownerId: "account-a" },
    jobs,
  );
  assert.equal(done.ownerId, "account-a");
  const remaining = galleryRows().filter((record) => record.jobId === "shared-job");
  assert.deepEqual(remaining.map((record) => record.ownerId).sort(), ["account-a", "account-b"]);
  assert.equal(remaining.find((record) => record.ownerId === "account-b").status, "pending");
});

test("repeated gallery filters match any of their values and combine across filters", async () => {
  const made = (jobId, model, width, height) => ({
    ...item("account-a", jobId),
    model,
    width,
    height,
  });
  setGallery([
    made("job-flux", "flux.safetensors", 1024, 1024),
    made("job-sdxl", "sdxl.safetensors", 1344, 768),
    made("job-wan", "wan.safetensors", 1024, 1024),
  ]);
  const request = (query) => ({
    studioAccount: {
      userId: "account-a",
      role: "user",
      authenticated: true,
      features: {},
    },
    query,
  });
  const ids = async (query) =>
    (await call(routes["/api/gallery"], request({ limit: "50", ...query }))).items
      .map((record) => record.jobId)
      .sort();
  assert.deepEqual(await ids({ model: ["flux", "sdxl"] }), ["job-flux", "job-sdxl"]);
  assert.deepEqual(await ids({ model: "wan" }), ["job-wan"]);
  assert.deepEqual(await ids({ model: ["flux", "sdxl"], aspect: ["square", "portrait"] }), [
    "job-flux",
  ]);
  assert.deepEqual(
    await ids({ model: ["", ""] }),
    ["job-flux", "job-sdxl", "job-wan"],
    "blank values are no filter",
  );
});

test("gallery filter options cover the owned gallery without exposing other accounts or media kinds", async () => {
  setGallery([
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
      features: {},
    },
    query: { type: "image", limit: "60", q: "no-match" },
  };
  const facets = await call(routes["/api/gallery/filters"], request);
  assert.deepEqual(facets.models, ["base-model", "late-model", "shared-model"]);
  assert.deepEqual(facets.loras, ["detail.safetensors"]);
  assert.equal(facets.sizes[0].value, "up-to-1k");
  assert.deepEqual(
    facets.aspects.map((aspect) => aspect.label),
    ["Landscape", "Portrait", "Square"],
  );
});

test("search matches an image's caption as well as its prompt, within the account's own records", async () => {
  const caption = (text, tags = []) => ({
    text,
    tags,
    model: "vision-model",
    at: "2026-10-26T09:00:00.000Z",
    version: 2,
  });
  setGallery([
    {
      ...item("account-a", "job-fox"),
      caption: caption("A red fox in deep snow at dusk.", ["wildlife", "winter scene"]),
    },
    { ...item("account-a", "job-plain"), prompt: "red fox portrait" },
    { ...item("account-b", "job-other"), caption: caption("A red fox in the snow.") },
  ]);
  const ids = async (q) =>
    (
      await call(routes["/api/gallery"], {
        studioAccount: {
          userId: "account-a",
          role: "user",
          authenticated: true,
          features: {},
        },
        query: { q },
      })
    ).items
      .map((record) => record.jobId)
      .sort();
  assert.deepEqual(await ids("Fox SNOW"), ["job-fox"]);
  assert.deepEqual(await ids("red fox"), ["job-fox", "job-plain"]);
  assert.deepEqual(
    await ids("dusk private"),
    ["job-fox"],
    "words may come from caption and prompt",
  );
  assert.deepEqual(await ids("winter wildlife"), ["job-fox"], "and from the caption's tags");
});

test("search adds images that look like it to the text matches, and filters still apply", async () => {
  setGallery([
    { ...item("account-a", "job-cat"), model: "flux" },
    { ...item("account-a", "job-cat-sdxl"), model: "sdxl" },
    { ...item("account-a", "job-prompt"), model: "flux", prompt: "ginger cat" },
    { ...item("account-a", "job-other"), model: "flux" },
  ]);
  near = (q) => (q === "ginger cat" ? (record) => record.jobId.startsWith("job-cat") : null);
  const ids = async (query) =>
    (
      await call(routes["/api/gallery"], {
        studioAccount: {
          userId: "account-a",
          role: "user",
          authenticated: true,
          features: {},
        },
        query,
      })
    ).items
      .map((record) => record.jobId)
      .sort();
  try {
    assert.deepEqual(await ids({ q: "ginger cat" }), ["job-cat", "job-cat-sdxl", "job-prompt"]);
    assert.deepEqual(await ids({ q: "ginger cat", model: "flux" }), ["job-cat", "job-prompt"]);
    assert.deepEqual(await ids({ q: "dog" }), [], "no look-alikes, no text match");
  } finally {
    near = () => null;
  }
});

test("origin filters retain ownership, other filters and stable cursors as matching results arrive", async () => {
  const ownerId = "origin-account";
  const request = {
    studioAccount: { userId: ownerId, role: "user", authenticated: true, features: {} },
    query: {},
  };
  const dream = (jobId, extra = {}) => ({
    ...item(ownerId, jobId),
    dream: { state: "kept" },
    prompt: "a lantern",
    rating: "liked",
    resultSet: { id: "origin-set", title: "Lanterns" },
    width: 1024,
    height: 1024,
    ...extra,
  });
  const rows = [
    dream("origin-z"),
    dream("origin-m"),
    dream("origin-a"),
    dream("origin-other-owner", { ownerId: "origin-stranger" }),
    dream("origin-pooled", { dream: { state: "unseen" } }),
    dream("origin-discarded", { dream: { state: "discarded" }, rating: "disliked" }),
    dream("origin-unrated", { rating: undefined }),
    dream("origin-video", { type: "video" }),
    dream("origin-other-model", { model: "other" }),
    dream("origin-other-set", { resultSet: { id: "other-set", title: "Other" } }),
    dream("origin-old", { createdAt: "2025-01-01" }),
    dream("origin-chat", { dream: undefined, chat: { conversationId: "chat" } }),
    dream("origin-unknown", { dream: undefined }),
  ];
  setGallery(rows);
  const query = {
    origin: "dream",
    q: "lantern",
    rating: "liked",
    type: "image",
    model: "test-model",
    set: "origin-set",
    since: "2026-01-01",
    size: "up-to-1k",
    aspect: "square",
    limit: "1",
  };
  const read = (extra = {}) =>
    call(routes["/api/gallery"], { ...request, query: { ...query, ...extra } });
  const ids = (page) => page.items.map((row) => row.id);
  const first = await read();
  assert.deepEqual(ids(first), ["origin-z-0"]);
  assert.equal(first.totalApprox, 3);
  const added = dream("origin-new", { createdAt: "2026-11-01" });
  setGallery([added, ...rows]);
  assert.deepEqual(ids(await read()), [added.id], "refresh includes new matching work");
  const rest = await read({ cursor: first.nextCursor, limit: "500" });
  assert.deepEqual(
    ids(rest),
    ["origin-m-0", "origin-a-0"],
    "quick select's later page keeps the same matches without repeats",
  );
  assert.equal(rest.hasMore, false);
  assert.equal(rest.totalApprox, 4);
  const all = await read({ origin: ["chat", "dream"], limit: "500" });
  assert.equal(all.items.length, 5);
  assert.ok(ids(all).includes("origin-chat-0"));
  assert.deepEqual(ids(await read({ origin: "chat", limit: "500" })), ["origin-chat-0"]);
  const disliked = await read({ rating: "disliked", limit: "500" });
  assert.deepEqual(ids(disliked), ["origin-discarded-0"]);
});

test("origin filters narrow queued and running tiles without hiding matching unfinished work", async () => {
  const ownerId = "origin-pending-account";
  saveAccountPreferences(ownerId, { galleryWork: "queued" });
  const session = queue.createSession(ownerId);
  const input = { kind: "image", prompt: "a lantern", chat: { conversationId: "chat" } };
  const waiting = queue.enqueue(ownerId, session.id, input, "image");
  const unknown = queue.enqueue(
    ownerId,
    session.id,
    { kind: "image", prompt: "a lantern" },
    "image",
  );
  const started = queue.enqueue(ownerId, session.id, input, "image");
  const running = {
    ...item(ownerId, started.id),
    status: "pending",
    chat: input.chat,
  };
  setGallery([running]);
  const read = (origin) =>
    call(routes["/api/gallery"], {
      studioAccount: { userId: ownerId, role: "user", authenticated: true, features: {} },
      query: { origin, q: "unfinished prompt", model: "unfinished model" },
    });
  const chat = await read("chat");
  assert.deepEqual(
    chat.items.map((item) => item.jobId),
    [waiting.id, running.jobId],
  );
  assert.deepEqual((await read("dream")).items, []);
  assert.equal((await read("")).items.length, 3);
  for (const job of [started, waiting, unknown]) queue.save({ ...job, status: "cancelled" });
});

test("queued work leads the first page, but a retry waits in its original's place", async () => {
  const ownerId = "retry-place-account";
  saveAccountPreferences(ownerId, { galleryWork: "queued" });
  const session = queue.createSession(ownerId);
  const input = { kind: "image", prompt: "a lantern" };
  const waiting = queue.enqueue(ownerId, session.id, input, "image");
  const retry = queue.enqueue(
    ownerId,
    session.id,
    input,
    "image",
    undefined,
    undefined,
    undefined,
    {
      galleryAt: "2026-10-15T00:00:00.000Z",
    },
  );
  setGallery([
    { ...item(ownerId, "newer"), createdAt: "2026-10-20T00:00:00.000Z" },
    { ...item(ownerId, "older"), createdAt: "2026-10-10T00:00:00.000Z" },
  ]);
  const get = (query) =>
    call(routes["/api/gallery"], {
      studioAccount: { userId: ownerId, role: "user", authenticated: true, features: {} },
      query,
    });
  const page = await get({});
  assert.deepEqual(
    page.items.map((row) => row.jobId),
    [waiting.id, "newer", retry.id, "older"],
  );
  assert.equal(page.items[2].createdAt, retry.createdAt);
  assert.equal(page.items[2].galleryAt, retry.galleryAt);
  assert.deepEqual(
    (await get({ select: "all", limit: "1" })).items.map((row) => row.jobId),
    [waiting.id, "newer", "older"],
    "a quick select includes queued tiles in the list, leaving a retry beyond page one to start",
  );
  for (const job of [waiting, retry]) queue.save({ ...job, status: "cancelled" });
});
