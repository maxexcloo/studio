import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import sharp from "sharp";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-preset-routes-"));
process.env.STUDIO_DATA_DIR = dir;
process.env.STUDIO_ENV_FILE = path.join(dir, ".env");
process.env.STUDIO_ENABLE_PRESETS = "1";
delete process.env.CIVITAI_API_TOKEN;
fs.writeFileSync(
  path.join(dir, "presets.json"),
  JSON.stringify([
    {
      id: "43",
      name: "Legacy Landscape",
      previewUrl: "https://image.civitai.com/legacy.png",
      sourceUrl: "https://civitai.com/images/43",
      prompt: "an older saved landscape",
      negative: "",
      settings: { seed: "0" },
      resources: [],
      warnings: [],
      savedAt: "2025-01-01T00:00:00Z",
    },
  ]),
);
const { registerPresetRoutes } = await import("./preset-routes.js");
const { downloadPresetImage } = await import("./civitai-library.js");
const bytes = Buffer.from("model");
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
let online = true;
const image = await sharp({
  create: { width: 128, height: 192, channels: 3, background: "#527b8f" },
})
  .png()
  .toBuffer();
const queued = [];
const store = await import("./gallery-store.js");
const references = await import("./references.js");
let validImage = true;
let sourcePrompt = "a landscape";
let sourceType = "image";
let videoBytes;
const app = express();
app.use(express.json());
registerPresetRoutes(app, {
  models: async () => ({ profiles: [], loras: [] }),
  imageRequest: async () =>
    new Response(
      validImage ? (sourceType === "video" ? videoBytes : image) : Buffer.from("not an image"),
    ),
  download: async (spec) => {
    queued.push(spec);
    return { status: "queued" };
  },
  json: async (url) => {
    if (!online) throw new Error("offline");
    if (url.startsWith("images?"))
      return {
        items: [
          {
            id: 42,
            url: "https://image.civitai.com/example.png",
            type: sourceType,
            meta: {
              id: 42,
              meta: {
                prompt: sourcePrompt,
                seed: 0,
                civitaiResources: [{ modelVersionId: 17, weight: 0.6 }],
              },
            },
          },
        ],
      };
    return {
      id: 17,
      modelId: 9,
      name: "V1",
      model: { name: "Style", type: "LORA" },
      files: [{ id: 3, type: "Model", name: "style.safetensors", hashes: { SHA256: sha256 } }],
    };
  },
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (url, body, method = body ? "POST" : "GET", headers = {}) => {
  const response = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
};
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the import, save, offline reuse and deletion routes retain the recipe", async () => {
  const imported = await api("/api/presets/import", { url: "https://civitai.com/images/42" });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.preset.settings.seed, "0");
  assert.equal(imported.body.preset.galleryItemId, "civitai:42");
  const item = store.gallery.find((item) => item.id === "civitai:42");
  assert.equal(item.prompt, "a landscape");
  assert.equal(item.settings.seed, "0");
  assert.equal(item.width, 128);
  assert.equal(item.height, 192);
  assert.deepEqual(item.settings.loras, [
    { name: "style.safetensors", strength: 0.6, enabled: true },
  ]);
  assert.equal(item.civitai.resources[0].versionId, 17);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].file, "style.safetensors");
  const media = await fetch(base + item.url);
  assert.equal(media.status, 200);
  const full = Buffer.from(await media.arrayBuffer());
  assert.equal((await sharp(full).metadata()).height, 192);
  const { readMediaInfo } = await import("./library.js");
  assert.match((await readMediaInfo(store.importedImageFile(item))).prompt, /a landscape/);
  const clean = Buffer.from(await (await fetch(base + item.url + "?clean=1")).arrayBuffer());
  assert.ok(clean.length < full.length);
  const asset = references.referenceAssetFromGallery({}, item.id);
  const reference = await references.bytesForReference({}, asset.id);
  assert.deepEqual(reference.buffer, full);

  assert.equal(imported.body.preset.resources[0].status, "missing");
  assert.equal(imported.body.preset.resources[0].spec, undefined);
  const saved = await api("/api/presets", { id: "42", name: "My Landscape" });
  assert.equal(saved.body.preset.name, "My Landscape");
  online = false;
  const list = await api("/api/presets");
  assert.equal(list.body.presets.find((item) => item.id === "42").name, "My Landscape");
  const resolved = await api("/api/presets/resolve", { id: "42" });
  assert.equal(resolved.body.preset.prompt, "a landscape");
  assert.equal(resolved.body.preset.resources[0].weight, 0.6);
  online = true;
  sourcePrompt = "updated source landscape";
  store.addGalleryItems([
    {
      ...store.gallery.find((item) => item.id === "civitai:42"),
      createdAt: "2025-01-01T00:00:00Z",
    },
  ]);
  const reimported = await api("/api/presets/import", { url: "https://civitai.red/images/42" });
  assert.equal(reimported.status, 200);
  assert.equal(reimported.body.preset.prompt, sourcePrompt);
  const { readPngInfo } = await import("./png-text.js");
  const current = store.gallery.find((item) => item.id === "civitai:42");
  assert.ok(Date.parse(current.createdAt) > Date.parse("2025-01-01T00:00:00Z"));
  assert.equal(
    JSON.parse(readPngInfo(store.importedImageFile(current)).text.civitai).prompt,
    sourcePrompt,
  );
  assert.equal(current.civitai.sourceMetadata.prompt, sourcePrompt);
  sourcePrompt = "a landscape";
  store.setGallery(store.gallery.filter((item) => item.id !== current.id));
  assert.equal((await fetch(base + "/api/presets/42/media")).status, 404);
  assert.equal((await fetch(base + "/api/presets/42/thumbnail")).status, 404);
  assert.equal((await api("/api/presets/resolve", { id: "42" })).status, 400);
  store.addGalleryItems([current]);
  await api("/api/presets/42", null, "DELETE");
  assert.equal(fs.existsSync(store.importedImageFile(current)), false);

  assert.equal(
    (await api("/api/presets")).body.presets.some((item) => item.id === "42"),
    false,
  );
});

test("video imports save originals, serve byte ranges and generate thumbnails", async () => {
  const { default: encoder } = await import("ffmpeg-static");
  videoBytes = execFileSync(encoder || "ffmpeg", [
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x64:r=10",
    "-t",
    "1",
    "-an",
    "-c:v",
    "libx264",
    "-f",
    "mp4",
    "-movflags",
    "frag_keyframe+empty_moov",
    "-loglevel",
    "error",
    "pipe:1",
  ]);
  sourceType = "video";
  online = true;
  try {
    const result = await api("/api/presets/import", { url: "https://civitai.red/images/42" });
    assert.equal(result.status, 200);
    assert.equal(result.body.preset.type, "video");
    const item = store.gallery.find((item) => item.id === "civitai:42");
    assert.equal(item.type, "video");
    assert.equal(item.width, 64);
    assert.match(store.importedImageFile(item), /42\.mp4$/);
    const media = await fetch(base + item.url, { headers: { range: "bytes=0-31" } });
    assert.equal(media.status, 206);
    assert.equal((await media.arrayBuffer()).byteLength, 32);
    assert.match(media.headers.get("content-type"), /video\/mp4/);
    const thumbnail = await fetch(base + item.thumbnailUrl);
    assert.equal(thumbnail.status, 200);
    assert.match(thumbnail.headers.get("content-type"), /image\/jpeg/);
    assert.equal((await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata()).width, 64);
    const poster = await fetch(base + "/api/presets/42/video-preview?poster=1");
    assert.equal(poster.status, 200);
    assert.match(poster.headers.get("content-type"), /image\/jpeg/);
    assert.equal((await sharp(Buffer.from(await poster.arrayBuffer())).metadata()).width, 64);
  } finally {
    await api("/api/presets/42", null, "DELETE");
    sourceType = "image";
  }
});

test("saved recipes migrate into gallery images without a duplicate recipe store", async () => {
  for (
    let attempt = 0;
    attempt < 100 && !store.gallery.some((item) => item.id === "civitai:43");
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  const item = store.gallery.find((item) => item.id === "civitai:43");
  assert.ok(item);
  assert.equal(item.prompt, "an older saved landscape");
  assert.equal(item.settings.seed, "0");
  assert.ok(fs.existsSync(store.importedImageFile(item)));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "presets.json"), "utf8")), []);
  await api("/api/presets/43", null, "DELETE");
});

test("failed image downloads leave no gallery record or model download", async () => {
  online = true;
  validImage = false;
  const before = queued.length;
  try {
    const result = await api("/api/presets/import", { url: "https://civitai.com/images/42" });
    assert.equal(result.status, 400);
    assert.equal(
      store.gallery.some((item) => item.id === "civitai:42"),
      false,
    );
    assert.equal(queued.length, before);
  } finally {
    validImage = true;
  }
});

test("write routes refuse unsigned remote devices", async () => {
  const response = await api("/api/presets", { id: "42", name: "Denied" }, "POST", {
    "x-forwarded-for": "192.168.1.40",
  });
  assert.equal(response.status, 403);
});

test("browser-supplied downloads and paths cannot bypass preview resolution", async () => {
  const response = await api("/api/library/downloads", {
    id: "unknown",
    url: "http://127.0.0.1/secret",
    folder: "../",
  });
  assert.equal(response.status, 400);
  const thumbnail = await fetch(base + "/api/presets/not-an-id/thumbnail");
  assert.equal(thumbnail.status, 400);
});

test("disabled instances refuse every preset and provider download route", async () => {
  try {
    for (const enabled of [undefined, "0"]) {
      if (enabled === undefined) delete process.env.STUDIO_ENABLE_PRESETS;
      else process.env.STUDIO_ENABLE_PRESETS = enabled;
      const { mockModelResult, offlineModelResult } = await import("./models.js");
      assert.equal(mockModelResult().features.presets, false);
      assert.equal(offlineModelResult().features.presets, false);
      for (const [method, url] of [
        ["GET", "/api/presets"],
        ["POST", "/api/presets"],
        ["POST", "/api/presets/import"],
        ["POST", "/api/presets/resolve"],
        ["DELETE", "/api/presets/42"],
        ["GET", "/api/presets/42/thumbnail"],
        ["GET", "/api/presets/42/media"],
        ["GET", "/api/library/downloads"],
        ["POST", "/api/library/downloads"],
        ["POST", "/api/library/downloads/preview"],
      ]) {
        const response = await fetch(base + url, { method });
        assert.equal(response.status, 404, `${method} ${url} with flag ${enabled}`);
      }
    }
  } finally {
    process.env.STUDIO_ENABLE_PRESETS = "1";
  }
});

test("split workflow imports queue verified model, encoder, VAE and LoRA files and retain their associations", async () => {
  const downloads = [];
  const resources = [
    ["diffusion_models", "exact-int8.safetensors"],
    ["text_encoders", "exact-encoder.safetensors"],
    ["vae", "exact-vae.safetensors"],
    ["loras", "style-slider.safetensors"],
  ].map(([folder, file]) => {
    const id = `hf:test:${folder}:${file}`;
    return {
      versionId: id,
      file,
      folder,
      name: file,
      supported: true,
      sha256,
      weight: folder === "loras" ? 15 : null,
      spec: {
        id,
        file,
        folder,
        sha256,
        url: "https://huggingface.co/example/model/resolve/" + "a".repeat(40) + "/" + file,
      },
    };
  });
  await downloadPresetImage(
    {
      id: "143425442",
      name: "Public Metadata Fixture",
      type: "image",
      previewUrl: "https://image.civitai.com/fixture.png",
      prompt: "A landscape",
      negative: "",
      settings: {},
      resources,
      warnings: [],
    },
    {
      models: async () => ({ profiles: [], textEncoders: [], vaes: [], loras: [] }),
      imageRequest: async () => new Response(image),
      download: async (spec) => {
        downloads.push(spec);
        return { status: "queued" };
      },
    },
  );
  assert.deepEqual(
    downloads.map((spec) => spec.folder),
    ["diffusion_models", "text_encoders", "vae", "loras"],
  );
  const item = store.gallery.find((item) => item.id === "civitai:143425442");
  assert.equal(item.model, "exact-int8.safetensors");
  assert.equal(item.settings.textEncoder, "exact-encoder.safetensors");
  assert.deepEqual(item.settings.textEncoders, ["exact-encoder.safetensors"]);
  assert.equal(item.settings.vae, "exact-vae.safetensors");
  assert.deepEqual(item.settings.loras, [
    { name: "style-slider.safetensors", strength: 15, enabled: true },
  ]);
});
