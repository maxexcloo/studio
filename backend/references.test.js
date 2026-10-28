import "./fixtures/local-worker.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-references-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_COMFY_INPUT_DIR = temporary;
const referenceAssets = await import(`./references.js?test=${Date.now()}`);
const { pageGallery } = await import("./gallery-store.js");
const upload = async (...args) => (await referenceAssets.saveUploadedImage(...args)).asset;

test("an upload becomes its owner's uploaded gallery image, listed only under Uploads", async () => {
  const buffer = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "#223344" },
  })
    .png()
    .toBuffer();
  const { item, asset } = await referenceAssets.saveUploadedImage({
    buffer,
    name: "sample.png",
    mime: "image/png",
  });
  assert.equal(item.uploaded, true);
  assert.equal(item.status, "done");
  assert.equal(asset.source, "upload");
  assert.equal(asset.name, "sample.png");
  assert.equal(asset.galleryItemId, item.id);
  assert.equal(asset.width, 32);
  assert.equal(asset.height, 24);
  assert.equal(
    pageGallery({}).items.some((listed) => listed.id === item.id),
    false,
  );
  assert.deepEqual(
    pageGallery({ uploads: true }).items.map((listed) => listed.id),
    [item.id],
  );
  assert.deepEqual((await referenceAssets.bytesForReference({}, asset.id)).buffer, buffer);
  assert.deepEqual(
    (await referenceAssets.bytesForReference({}, item.id)).buffer,
    buffer,
    "a reference saved with the upload's own id still resolves",
  );
  assert.equal((await upload({ buffer, name: "again.png", mime: "image/png" })).id, asset.id);
});

test("uploaded images and byte reads are limited to their account owner", async () => {
  const buffer = await sharp({
    create: { width: 20, height: 18, channels: 3, background: "#456789" },
  })
    .png()
    .toBuffer();
  const ownerA = { studioAccount: { userId: "account-a", role: "user" } };
  const assetA = await upload({ buffer, name: "same.png", mime: "image/png" }, "account-a");
  const assetB = await upload({ buffer, name: "same.png", mime: "image/png" }, "account-b");

  assert.notEqual(assetA.id, assetB.id, "identical bytes do not join two users' uploads");
  assert.equal(referenceAssets.referenceExistsForAccount(ownerA.studioAccount, assetA.id), true);
  assert.equal(referenceAssets.referenceExistsForAccount(ownerA.studioAccount, assetB.id), false);
  await assert.rejects(
    referenceAssets.bytesForReference(ownerA, assetB.id),
    /no longer in the gallery/,
  );
});

test("non-image uploads are rejected", async () => {
  await assert.rejects(() =>
    upload({
      buffer: Buffer.from("not an image"),
      name: "fake.png",
      mime: "image/png",
    }),
  );
});

test("staging resizes every slot before upload, keeps originals, and isolates temporary copies", async (t) => {
  const source = await sharp({
    create: {
      width: 3000,
      height: 4000,
      channels: 4,
      background: { r: 30, g: 60, b: 90, alpha: 0.4 },
    },
  })
    .png()
    .toBuffer();
  const asset = await upload({
    buffer: source,
    name: "portrait.png",
    mime: "image/png",
  });
  const uploads = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const file = init.body.get("image");
    uploads.push({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
    return new Response(JSON.stringify({ name: file.name }), {
      headers: { "content-type": "application/json" },
    });
  });
  const refs = [
    { slot: "start", assetId: asset.id },
    { slot: "reference", assetId: asset.id },
  ];
  const generation = { family: "sdxl", width: 1024, height: 1024 };
  const staged = await referenceAssets.stageReferenceAssets({}, refs, { generation });
  assert.equal(staged.length, 2);
  assert.notEqual(
    staged[0].comfyName,
    staged[1].comfyName,
    "parallel runs must not share deletable resized files",
  );
  for (const item of staged) {
    assert.equal(item.temporary, true);
    assert.ok(item.width * item.height <= 1024 ** 2);
    assert.equal(item.width % 8, 0);
    assert.equal(item.height % 8, 0);
  }
  assert.ok((await sharp(uploads[0].buffer).metadata()).hasAlpha);
  assert.deepEqual((await referenceAssets.bytesForReference({}, asset.id)).buffer, source);

  const off = await referenceAssets.stageReferenceAssets({}, refs.slice(0, 1), {
    generation: { ...generation, autoResizeInputs: false },
  });
  assert.equal(off[0].temporary, undefined);
  assert.deepEqual(uploads.at(-1).buffer, source);
  await referenceAssets.stageReferenceAssets({}, refs.slice(0, 1));
  assert.deepEqual(uploads.at(-1).buffer, source, "upscale operations keep full resolution");

  const painted = await referenceAssets.stageReferenceAssets({}, refs, {
    generation: { ...generation, inpaint: { mask: "painted" } },
  });
  assert.equal(painted[0].temporary, undefined);
  assert.deepEqual(
    uploads.at(-2).buffer,
    source,
    "inpaint source and mask retain their coordinate system",
  );
  assert.equal(painted[1].temporary, true, "additional references still resize");
  delete process.env.STUDIO_COMFY_INPUT_DIR;
  const remote = await referenceAssets.stageReferenceAssets({}, refs, { generation });
  assert.equal(
    remote[0].comfyName,
    remote[1].comfyName,
    "remote runs reuse content-named resized uploads",
  );
  assert.equal(remote[0].temporary, undefined);
  process.env.STUDIO_COMFY_INPUT_DIR = temporary;
});

test("failed staging removes already-uploaded temporary copies", async (t) => {
  const buffer = await sharp({
    create: { width: 2000, height: 2000, channels: 3, background: "#334455" },
  })
    .png()
    .toBuffer();
  const asset = await upload({
    buffer,
    name: "rollback.png",
    mime: "image/png",
  });
  let uploadedFile;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const file = init.body.get("image");
    uploadedFile = path.join(temporary, file.name);
    fs.writeFileSync(uploadedFile, Buffer.from(await file.arrayBuffer()));
    return new Response(JSON.stringify({ name: file.name }), {
      headers: { "content-type": "application/json" },
    });
  });
  await assert.rejects(() =>
    referenceAssets.stageReferenceAssets(
      {},
      [
        { slot: "start", assetId: asset.id },
        { slot: "reference", assetId: "gone" },
      ],
      { generation: { width: 512, height: 512 } },
    ),
  );
  assert.ok(uploadedFile);
  assert.equal(fs.existsSync(uploadedFile), false);
});

test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

test("a video’s last frame is referenced only by its owner and only for finished videos", async () => {
  const { gallery } = await import("./gallery-store.js");
  const owner = { studioAccount: { userId: "account-a", role: "user" } };
  const other = { studioAccount: { userId: "account-b", role: "user" } };
  const items = [
    {
      id: "extend-video",
      ownerId: "account-a",
      type: "video",
      status: "done",
      url: "/images/extend.mp4",
      outputName: "extend.mp4",
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "extend-image",
      ownerId: "account-a",
      type: "image",
      status: "done",
      url: "/images/extend.png",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ];
  gallery.push(...items);
  try {
    const asset = referenceAssets.referenceAssetFromGallery(owner, "extend-video", {
      frame: "last",
    });
    assert.match(asset.id, /^gallery:.+:last-frame$/);
    assert.equal(asset.mime, "image/png");
    assert.equal(asset.name, "extend last frame.png");
    assert.equal(asset.galleryItemId, "extend-video");
    assert.throws(
      () => referenceAssets.referenceAssetFromGallery(other, "extend-video", { frame: "last" }),
      /no longer in the gallery/,
    );
    assert.throws(
      () => referenceAssets.referenceAssetFromGallery(owner, "extend-image", { frame: "last" }),
      /no longer in the gallery/,
    );
    assert.throws(
      () => referenceAssets.referenceAssetFromGallery(owner, "extend-video"),
      /no longer in the gallery/,
      "a video is never a plain image reference",
    );
    await assert.rejects(
      referenceAssets.bytesForReference(other, asset.id),
      /no longer in the gallery/,
    );
  } finally {
    for (const item of items) gallery.splice(gallery.indexOf(item), 1);
  }
});
