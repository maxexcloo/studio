import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-reference-assets-"));
process.env.HEISS_DATA_DIR = temporary;
process.env.COMFY_INPUT_DIR = temporary;
const referenceAssets = await import(`./reference-assets.js?test=${Date.now()}`);

test("uploaded references are validated, indexed, thumbnailed, and deletable", async () => {
  const buffer = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#223344" } }).png().toBuffer();
  const asset = await referenceAssets.saveUploadedReference({ buffer, name: "sample.png", mime: "image/png" });
  assert.equal(asset.source, "upload");
  assert.equal(asset.width, 32);
  assert.equal(asset.height, 24);
  assert.equal(referenceAssets.listReferenceAssets({}, { source: "upload" }).items.length, 1);
  assert.ok(fs.existsSync(referenceAssets.readUploadedReference(asset.id, "media").file));
  assert.ok(fs.existsSync(referenceAssets.readUploadedReference(asset.id, "thumbnail").file));
  referenceAssets.deleteUploadedReference(asset.id);
  assert.equal(referenceAssets.listReferenceAssets({}, { source: "upload" }).items.length, 0);
});

test("a reference page maps only the items it returns", async () => {
  const saved = [];
  for (let index = 0; index < 5; index += 1) {
    // Distinct pixels: uploads are keyed by content, and five copies would be one asset.
    const buffer = await sharp({ create: { width: 16 + index, height: 16, channels: 3, background: `#12345${index}` } }).png().toBuffer();
    saved.push(await referenceAssets.saveUploadedReference({ buffer, name: `page-${index}.png`, mime: "image/png" }));
  }
  const first = referenceAssets.listReferenceAssets({}, { source: "upload", limit: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);
  const second = referenceAssets.listReferenceAssets({}, { source: "upload", cursor: first.nextCursor, limit: 2 });
  assert.equal(second.items.length, 2);
  assert.equal(second.hasMore, true);
  const third = referenceAssets.listReferenceAssets({}, { source: "upload", cursor: second.nextCursor, limit: 2 });
  assert.equal(third.items.length, 1);
  assert.equal(third.hasMore, false);
  assert.equal(third.nextCursor, "");
  for (const asset of saved) referenceAssets.deleteUploadedReference(asset.id);
});

test("uploaded reference assets and byte reads are limited to their account owner", async () => {
  const buffer = await sharp({ create: { width: 20, height: 18, channels: 3, background: "#456789" } }).png().toBuffer();
  const ownerA = { heissAccount: { userId: "account-a", role: "user" } };
  const ownerB = { heissAccount: { userId: "account-b", role: "user" } };
  const assetA = await referenceAssets.saveUploadedReference({ buffer, name: "same.png", mime: "image/png" }, "account-a");
  const assetB = await referenceAssets.saveUploadedReference({ buffer, name: "same.png", mime: "image/png" }, "account-b");

  assert.notEqual(assetA.id, assetB.id, "identical bytes do not join two users' asset records");
  assert.deepEqual(referenceAssets.listReferenceAssets(ownerA, { source: "upload" }).items.map((item) => item.id), [assetA.id]);
  assert.deepEqual(referenceAssets.listReferenceAssets(ownerB, { source: "upload" }).items.map((item) => item.id), [assetB.id]);
  assert.equal(referenceAssets.readUploadedReference(assetB.id, "media", "account-a"), null);
  await assert.rejects(referenceAssets.bytesForReference(ownerA, assetB.id), /no longer in the gallery/);
  assert.throws(() => referenceAssets.deleteUploadedReference(assetB.id, "account-a"), /gone/);
  assert.ok(referenceAssets.readUploadedReference(assetB.id, "media", "account-b"));
  referenceAssets.deleteUploadedReference(assetA.id, "account-a");
  referenceAssets.deleteUploadedReference(assetB.id, "account-b");
});

test("non-image uploads are rejected", async () => {
  await assert.rejects(() => referenceAssets.saveUploadedReference({ buffer: Buffer.from("not an image"), name: "fake.png", mime: "image/png" }));
});

test("staging resizes every slot before upload, keeps originals, and isolates temporary copies", async (t) => {
  const source = await sharp({ create: { width: 3000, height: 4000, channels: 4, background: { r: 30, g: 60, b: 90, alpha: 0.4 } } }).png().toBuffer();
  const asset = await referenceAssets.saveUploadedReference({ buffer: source, name: "portrait.png", mime: "image/png" });
  const uploads = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const file = init.body.get("image");
    uploads.push({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
    return new Response(JSON.stringify({ name: file.name }), { headers: { "content-type": "application/json" } });
  });
  const refs = [{ slot: "start", assetId: asset.id }, { slot: "reference", assetId: asset.id }];
  const generation = { family: "sdxl", width: 1024, height: 1024 };
  const staged = await referenceAssets.stageReferenceAssets({}, refs, { generation });
  assert.equal(staged.length, 2);
  assert.notEqual(staged[0].comfyName, staged[1].comfyName, "parallel runs must not share deletable resized files");
  for (const item of staged) {
    assert.equal(item.temporary, true);
    assert.ok(item.width * item.height <= 1024 ** 2);
    assert.equal(item.width % 8, 0);
    assert.equal(item.height % 8, 0);
  }
  assert.ok((await sharp(uploads[0].buffer).metadata()).hasAlpha);
  assert.deepEqual((await referenceAssets.bytesForReference({}, asset.id)).buffer, source);

  const off = await referenceAssets.stageReferenceAssets({}, refs.slice(0, 1), { generation: { ...generation, autoResizeInputs: false } });
  assert.equal(off[0].temporary, undefined);
  assert.deepEqual(uploads.at(-1).buffer, source);
  await referenceAssets.stageReferenceAssets({}, refs.slice(0, 1));
  assert.deepEqual(uploads.at(-1).buffer, source, "upscale operations keep full resolution");

  const painted = await referenceAssets.stageReferenceAssets({}, refs, { generation: { ...generation, inpaint: { mask: "painted" } } });
  assert.equal(painted[0].temporary, undefined);
  assert.deepEqual(uploads.at(-2).buffer, source, "inpaint source and mask retain their coordinate system");
  assert.equal(painted[1].temporary, true, "additional references still resize");
  delete process.env.COMFY_INPUT_DIR;
  const remote = await referenceAssets.stageReferenceAssets({}, refs, { generation });
  assert.equal(remote[0].comfyName, remote[1].comfyName, "remote runs reuse content-named resized uploads");
  assert.equal(remote[0].temporary, undefined);
  process.env.COMFY_INPUT_DIR = temporary;
  referenceAssets.deleteUploadedReference(asset.id);
});

test("failed staging removes already-uploaded temporary copies", async (t) => {
  const buffer = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: "#334455" } }).png().toBuffer();
  const asset = await referenceAssets.saveUploadedReference({ buffer, name: "rollback.png", mime: "image/png" });
  let uploadedFile;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const file = init.body.get("image");
    uploadedFile = path.join(temporary, file.name);
    fs.writeFileSync(uploadedFile, Buffer.from(await file.arrayBuffer()));
    return new Response(JSON.stringify({ name: file.name }), { headers: { "content-type": "application/json" } });
  });
  await assert.rejects(() => referenceAssets.stageReferenceAssets({}, [
    { slot: "start", assetId: asset.id }, { slot: "reference", assetId: "gone" }
  ], { generation: { width: 512, height: 512 } }));
  assert.ok(uploadedFile);
  assert.equal(fs.existsSync(uploadedFile), false);
  referenceAssets.deleteUploadedReference(asset.id);
});

test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test('search filters the full reference library before pagination and matches prompt words', async () => {
  const { gallery } = await import('./gallery-store.js');
  const items = Array.from({ length: 120 }, (_, index) => ({ id: `search-${index}`, type: 'image', status: 'done', url: `/images/search-${index}.png`, filename: `search-${index}.png`, prompt: index === 119 ? 'A Blue Mountain at Sunset' : 'A green forest', model: 'test-model', createdAt: new Date(1700000000000 + index).toISOString() }));
  gallery.push(...items);
  try {
    const found = referenceAssets.listReferenceAssets({}, { source: 'generation', q: 'mountain BLUE', limit: 1 });
    assert.equal(found.items.length, 1);
    assert.equal(found.items[0].galleryItemId, 'search-119');
    assert.equal(found.hasMore, false);
    assert.equal(referenceAssets.listReferenceAssets({}, { source: 'generation', q: 'not found' }).items.length, 0);
    assert.equal(referenceAssets.listReferenceAssets({}, { source: 'hidden', q: 'mountain' }).locked, true);
  } finally { for (const item of items) gallery.splice(gallery.indexOf(item), 1); }
});

test('a video’s last frame is referenced only by its owner and only for finished videos', async () => {
  const { gallery } = await import('./gallery-store.js');
  const owner = { heissAccount: { userId: 'account-a', role: 'user' } };
  const other = { heissAccount: { userId: 'account-b', role: 'user' } };
  const items = [
    { id: 'extend-video', ownerId: 'account-a', type: 'video', status: 'done', url: '/images/extend.mp4', outputName: 'extend.mp4', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'extend-image', ownerId: 'account-a', type: 'image', status: 'done', url: '/images/extend.png', createdAt: '2026-01-01T00:00:00Z' },
  ];
  gallery.push(...items);
  try {
    const asset = referenceAssets.referenceAssetFromGallery(owner, 'extend-video', { frame: 'last' });
    assert.match(asset.id, /^gallery:.+:last-frame$/);
    assert.equal(asset.mime, 'image/png');
    assert.equal(asset.name, 'extend last frame.png');
    assert.equal(asset.galleryItemId, 'extend-video');
    assert.throws(() => referenceAssets.referenceAssetFromGallery(other, 'extend-video', { frame: 'last' }), /no longer in the gallery/);
    assert.throws(() => referenceAssets.referenceAssetFromGallery(owner, 'extend-image', { frame: 'last' }), /no longer in the gallery/);
    assert.throws(() => referenceAssets.referenceAssetFromGallery(owner, 'extend-video'), /no longer in the gallery/, 'a video is never a plain image reference');
    await assert.rejects(referenceAssets.bytesForReference(other, asset.id), /no longer in the gallery/);
  } finally { for (const item of items) gallery.splice(gallery.indexOf(item), 1); }
});
