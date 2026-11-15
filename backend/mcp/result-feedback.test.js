import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import express from "express";
import sharp from "sharp";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-result-feedback-"));
process.env.STUDIO_DATA_DIR = dataDir;
process.env.STUDIO_MULTI_USER = "1";
const { createLocalAccount } = await import("../account-store.js");
const { directRoute } = await import("../domain/direct-route.ts");
const { Store } = await import("../domain/store.ts");
const { setGallery } = await import("../fixtures/gallery.js");
const { registerGalleryReadRoutes } = await import("../gallery/routes.js");
const { hideGalleryItems, setGalleryRatings } = await import("../gallery/store.js");
const { mediaPath, mediaSubfolder, mediaUrls } = await import("../media-paths.js");
const { openDatabase } = await import("../persistence/runtime.ts");
const { McpMedia } = await import("./media.js");
const { registerResultTools } = await import("./results.js");
const { createMcpDomainRequest, resolveSignedMcpResult } = await import("./studio-requests.js");

test("MCP reads current ratings through the production gallery route without exposing hidden outputs", async (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const alice = await createLocalAccount({
    username: "alice",
    password: "fixture-password",
    role: "administrator",
  });
  const bob = await createLocalAccount({
    username: "bob",
    password: "fixture-password",
    role: "administrator",
  });
  const jobId = "feedback-job";
  const scope = "feedback-chat";
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } })
    .png()
    .toBuffer();
  const output = (index, extra = {}) => {
    const ownerId = extra.ownerId || alice.id;
    const filename = `feedback-${index}.png`;
    const subfolder = mediaSubfolder(ownerId);
    const file = mediaPath(filename, subfolder);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!extra.missing) fs.writeFileSync(file, png);
    return {
      id: `${jobId}-${index}`,
      jobId,
      index,
      ownerId,
      status: "done",
      type: "image",
      prompt: "A harbour",
      width: 8,
      height: 8,
      settings: { profileId: "fixture-profile" },
      createdAt: "2026-11-01T00:00:00.000Z",
      ...mediaUrls(filename, subfolder),
      ...extra,
    };
  };
  const items = [
    output(0, { rating: "liked" }),
    output(1, { rating: "disliked" }),
    output(2),
    output(3, { ownerId: bob.id, rating: "liked" }),
    output(4, { dream: { state: "unseen" }, rating: "disliked" }),
    output(5, { dream: { state: "discarded" }, rating: "disliked" }),
    output(6, { rating: "disliked" }),
    output(7, { missing: true, rating: "liked" }),
  ];
  setGallery(items);
  hideGalleryItems([items[6]]);
  const app = express();
  registerGalleryReadRoutes(app, {
    store: new Store(openDatabase(":memory:")),
    near: async () => null,
  });
  // Gallery and file reads use production routes; status, catalogue and comparisons are fixtures.
  directRoute(app, "GET", "/api/jobs/:id", () => ({
    status: 200,
    payload: { status: "done", kind: "image", outputs: [] },
  }));
  directRoute(app, "GET", "/api/models", () => ({ status: 200, payload: { profiles: [] } }));
  directRoute(app, "GET", "/api/comparisons", () => ({
    status: 200,
    payload: { comparisons: [] },
  }));
  const media = new McpMedia({
    dataDir,
    publicUrl: "https://studio.example.test",
    signingKey: "fixture-key",
    domainRequest: createMcpDomainRequest({ app }),
    resolveSignedResult: resolveSignedMcpResult,
  });
  for (const owner of [alice.id, bob.id]) media.credentials.set(owner, { internal: true });
  media.adopt(alice.id, scope, { jobs: [jobId] });
  const tools = new Map();
  registerResultTools({
    tool: (_server, name, _title, _description, _schema, action) => tools.set(name, action),
    media,
    actor: { owner: alice.id, refs: scope },
    resolveOutput: (value, signal) => media.resolve(alice.id, scope, value, { signal }),
    reviewWaitSeconds: 0,
  });
  const read = (query = "") =>
    media.request("GET", `/api/gallery/jobs/${jobId}${query}`, undefined, alice.id);
  assert.deepEqual(
    (await read()).items.map(({ index, rating }) => [index, rating]),
    [
      [0, "liked"],
      [1, "disliked"],
      [2, undefined],
    ],
  );
  assert.equal((await read()).items[0].prompt, undefined);
  assert.equal((await read("?settings=1")).items[0].prompt, "A harbour");
  const results = await tools.get("result")({ job_id: jobId, wait_seconds: 0 });
  assert.deepEqual(
    results.structuredContent.outputs.map(({ output_index, rating }) => [output_index, rating]),
    [
      [0, "liked"],
      [1, "disliked"],
      [2, "unrated"],
    ],
  );
  const refs = results.structuredContent.outputs.map(({ ref }) => ref);
  assert.equal(new Set(refs).size, 3);
  assert.equal((await media.source(alice.id, jobId, 1)).rating, "disliked");
  const review = await tools.get("review")({ job_id: jobId, output_index: 1 });
  assert.match(review.content[0].text, /"output_index":1,"rating":"disliked"/);
  const token = media.token(alice.id, jobId, 1);
  const claims = media.claims(token);
  assert.deepEqual(
    (await media.signedResult(claims.owner, claims.jobId, claims.index)).content,
    png,
  );
  assert.deepEqual((await media.download(alice.id, jobId, 1)).content, png);

  setGalleryRatings([items[0].id], "disliked");
  setGalleryRatings([items[1].id], null);
  assert.deepEqual(
    (await read()).items.map(({ rating }) => rating),
    ["disliked", undefined, undefined],
  );
  const all = await tools.get("result")({ job_id: "all", wait_seconds: 0 });
  assert.deepEqual(
    all.structuredContent.results[0].outputs.map(({ ref, rating }) => [ref, rating]),
    [
      [refs[0], "disliked"],
      [refs[1], "unrated"],
      [refs[2], "unrated"],
    ],
  );
  const broad = await media.request("GET", "/api/gallery", undefined, alice.id);
  assert.deepEqual(
    broad.items.map(({ index }) => index),
    [1, 2],
  );
  assert.deepEqual(
    (await media.request("GET", "/api/gallery/jobs/missing", undefined, alice.id)).items,
    [],
  );
  assert.deepEqual(
    (await media.request("GET", `/api/gallery/jobs/${jobId}`, undefined, bob.id)).items.map(
      ({ index }) => index,
    ),
    [3],
  );
  await assert.rejects(media.result(bob.id, jobId), /this account/);
  for (const index of [3, 4, 5, 6, 7]) {
    assert.equal(await resolveSignedMcpResult(alice.id, jobId, index), null);
    await assert.rejects(media.source(alice.id, jobId, index), /available output/);
  }
  hideGalleryItems([items[1]]);
  assert.equal(await resolveSignedMcpResult(claims.owner, claims.jobId, claims.index), null);
  await assert.rejects(media.download(alice.id, jobId, 1), /available output/);
});
