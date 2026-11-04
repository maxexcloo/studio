import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { versionResource } from "../civitai/import.js";
import {
  civitaiAvailability,
  civitaiUncensored,
  detectLink,
  hfFolder,
  parseHfLink,
  plainDescription,
  resolveCivitaiModel,
  resolveHuggingFace,
} from "./sources.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("../fixtures/civitai/model-versions.json", import.meta.url), "utf8"),
);
const { model, versions } = fixture;
const now = Date.parse("2026-10-21T00:00:00Z");
const file = (version) => version.files[0];

test("Civitai availability: public files download, paid, early-access and restricted ones never do", () => {
  const rows = [
    ["public", true, undefined],
    ["earlyAccessOver", true, undefined],
    ["paid", false, "paid"],
    ["earlyAccess", false, "early-access"],
    ["generationOnly", false, "licence"],
    ["unknownAvailability", false, "licence"],
    ["unreadableEarlyAccess", false, "early-access"],
    ["noChecksum", false, "no-checksum"],
  ];
  for (const [name, available, reason] of rows) {
    const result = civitaiAvailability(versions[name], file(versions[name]), { now });
    assert.equal(result.available, available, name);
    assert.equal(result.reason, reason, name);
    if (!available) assert.ok(result.note, `${name} says why`);
  }
  assert.match(civitaiAvailability(versions.paid, file(versions.paid), { now }).note, /500 Buzz/);
  assert.equal(
    civitaiAvailability(
      { ...versions.public, model: { ...versions.public.model, mode: "TakenDown" } },
      file(versions.public),
      { now },
    ).reason,
    "licence",
  );
  assert.equal(
    civitaiAvailability({ ...versions.public, status: "Draft" }, file(versions.public), { now })
      .available,
    false,
    "an unpublished version",
  );
  assert.equal(
    civitaiAvailability({ ...versions.public, availability: 7 }, file(versions.public), { now })
      .available,
    false,
    "an unreadable availability",
  );
  assert.equal(civitaiAvailability(null).available, false);
});

test("a paid version gets no download spec anywhere, with the reason on the resource", () => {
  const paid = versionResource({ ...versions.paid }, 1, { now });
  assert.equal(paid.spec, null);
  assert.equal(paid.supported, false);
  assert.deepEqual(paid.unavailable.reason, "paid");
  assert.match(paid.note, /Buzz/);
  assert.ok(paid.bytes > 0, "its size still shows");
  const free = versionResource({ ...versions.public }, 1, { now });
  assert.equal(free.spec.id, "civitai:20:31");
  assert.equal(free.unavailable, undefined);
});

test("a Civitai LoRA link resolves its version and the catalogue entry, and suggests a free version for a paid one", async () => {
  const json = async (pathname) => {
    if (pathname === "models/9") return model;
    const id = Number(pathname.split("/")[1]);
    const version = Object.values(versions).find((item) => item.id === id);
    if (!version) throw new Error("That Civitai resource is unavailable.");
    return version;
  };
  const resolved = await resolveCivitaiModel("https://civitai.red/models/9?modelVersionId=20", {
    json,
    now,
  });
  assert.equal(resolved.resources.length, 1);
  const [resource] = resolved.resources;
  assert.deepEqual(
    [resource.role, resource.want.file, resource.want.folder, resource.supported],
    ["lora", "watercolour-v2.safetensors", "loras", true],
  );
  assert.equal(resource.want.sha256, "a".repeat(64));
  assert.deepEqual(resource.want.source, {
    provider: "civitai",
    modelId: 9,
    versionId: 20,
    fileId: 31,
    url: "https://civitai.com/models/9?modelVersionId=20",
  });
  assert.deepEqual(resolved.entry.links, {
    civitaiCom: "https://civitai.com/models/9?modelVersionId=20",
    civitaiRed: "https://civitai.red/models/9?modelVersionId=20",
  });
  assert.deepEqual(
    [
      resolved.entry.title,
      resolved.entry.version,
      resolved.entry.baseModel,
      resolved.entry.uncensored,
    ],
    ["Watercolour Style", "V2", "Krea 2", false],
  );
  assert.deepEqual(resolved.entry.triggers, ["wtrclr", "soft wash"]);
  assert.deepEqual(resolved.entry.strength, { default: 0.8 });
  assert.match(resolved.entry.description, /Soft watercolour washes\.\n• Use at 0\.8/);
  assert.match(resolved.entry.description, /Second release\./);
  assert.equal(resolved.entry.sha256, "a".repeat(64));
  assert.deepEqual(resolved.entry.source, {
    provider: "civitai",
    modelId: 9,
    versionId: 20,
    fileId: 31,
  });

  // No version in the link: the newest, which is paid here, with the newest free one suggested.
  const newest = await resolveCivitaiModel("https://civitai.com/models/9", {
    json: async (pathname) =>
      pathname === "models/9"
        ? model
        : pathname === "model-versions/30"
          ? versions.paid
          : json(pathname),
    now,
  });
  const [paid] = newest.resources;
  assert.equal(paid.supported, false);
  assert.equal(paid.spec, null);
  assert.equal(paid.unavailable.reason, "paid");
  assert.deepEqual(paid.unavailable.freeAlternative, {
    versionId: 20,
    name: "V2",
    url: "https://civitai.com/models/9?modelVersionId=20",
  });

  await assert.rejects(
    resolveCivitaiModel("https://civitai.com/models/9?modelVersionId=50", { json, now }),
    /another model/,
  );
  const checkpoint = await resolveCivitaiModel("https://civitai.com/models/12?modelVersionId=50", {
    json: async (pathname) =>
      pathname === "models/12"
        ? {
            id: 12,
            name: "Krea Fine Tune",
            type: "Checkpoint",
            modelVersions: [versions.checkpoint],
          }
        : versions.checkpoint,
    now,
  });
  assert.equal(checkpoint.entry, null, "checkpoints are recorded only");
  assert.deepEqual(
    [checkpoint.resources[0].role, checkpoint.resources[0].want.folder],
    ["checkpoint", "checkpoints"],
  );
});

test("a Civitai model counts as uncensored unless it says otherwise", () => {
  assert.equal(civitaiUncensored({ nsfw: false }), false);
  assert.equal(civitaiUncensored({ nsfw: true }), true);
  assert.equal(civitaiUncensored({ nsfwLevel: 1 }), false);
  assert.equal(civitaiUncensored({ nsfwLevel: 2 }), false);
  assert.equal(civitaiUncensored({ nsfwLevel: 4 }), true);
  assert.equal(civitaiUncensored({}), true);
  assert.equal(plainDescription("<p>A &amp; B</p><p>C</p>"), "A & B\nC");
});

test("links route by provider and shape", () => {
  assert.equal(detectLink("https://civitai.com/images/42"), "civitai-image");
  assert.equal(detectLink("https://civitai.red/models/9?modelVersionId=2"), "civitai-model");
  assert.equal(detectLink("https://huggingface.co/org/repo"), "hf-repo");
  assert.equal(detectLink("https://huggingface.co/org/repo/tree/main/split_files"), "hf-repo");
  assert.equal(
    detectLink("https://huggingface.co/org/repo/blob/main/model.safetensors"),
    "hf-file",
  );
  assert.throws(
    () => detectLink("https://example.com/model"),
    /civitai\.com, civitai\.red or huggingface\.co/,
  );
  assert.throws(() => detectLink("not a link"));
  assert.deepEqual(
    parseHfLink("https://huggingface.co/org/repo/resolve/main/a/b.gguf?download=true"),
    { owner: "org", repo: "repo", revision: "main", filePath: "a/b.gguf", folder: "" },
  );
  for (const bad of [
    "https://user:pw@huggingface.co/org/repo",
    "https://huggingface.co/datasets/org/repo",
    "https://huggingface.co/org/repo?token=x",
    "http://huggingface.co/org/repo",
  ])
    assert.throws(() => parseHfLink(bad), bad);
  assert.deepEqual(hfFolder("split_files/vae/ae.safetensors"), { folder: "vae", guessed: false });
  assert.deepEqual(hfFolder("text_encoders/umt5_xxl_fp8.safetensors"), {
    folder: "text_encoders",
    guessed: false,
  });
  assert.deepEqual(hfFolder("my-style.safetensors", { tags: ["lora"] }), {
    folder: "loras",
    guessed: false,
  });
  assert.deepEqual(hfFolder("model-q4.gguf"), { folder: "diffusion_models", guessed: true });
});

const hfResponse = (body, status = 200) =>
  new Response(status === 200 ? JSON.stringify(body) : null, { status });
const repo = {
  sha: "c".repeat(40),
  tags: ["lora", "not-for-all-audiences"],
  gated: false,
  cardData: { base_model: "black-forest-labs/FLUX.1-dev", instance_prompt: "ohwx style, film" },
  siblings: [
    { rfilename: "README.md" },
    { rfilename: "style.safetensors", lfs: { sha256: "d".repeat(64), size: 2048 } },
    { rfilename: "style-old.safetensors", size: 10 },
  ],
};

test("a Hugging Face file link imports that file; a repository lists its model files as optional", async () => {
  const urls = [];
  const request = async (url) => {
    urls.push(url);
    return hfResponse(repo);
  };
  const single = await resolveHuggingFace(
    "https://huggingface.co/org/repo/blob/main/style.safetensors",
    { request },
  );
  assert.match(urls[0], /\/api\/models\/org\/repo\/revision\/main\?blobs=true$/);
  assert.equal(single.resources.length, 1);
  const [resource] = single.resources;
  assert.deepEqual(
    [resource.role, resource.want.folder, resource.optional, resource.supported],
    ["lora", "loras", false, true],
  );
  assert.equal(resource.spec.id, `hf:org/repo:${"c".repeat(40)}:style.safetensors`);
  assert.equal(
    resource.spec.url,
    `https://huggingface.co/org/repo/resolve/${"c".repeat(40)}/style.safetensors`,
  );
  const entry = single.entryFor(resource);
  assert.deepEqual(
    [entry.baseModel, entry.uncensored, entry.sha256],
    ["black-forest-labs/FLUX.1-dev", true, "d".repeat(64)],
  );
  assert.deepEqual(entry.triggers, ["ohwx style", "film"]);
  assert.deepEqual(entry.source, {
    provider: "hf",
    repo: "org/repo",
    revision: "c".repeat(40),
    path: "style.safetensors",
  });

  const listing = await resolveHuggingFace("https://huggingface.co/org/repo", { request });
  assert.deepEqual(
    listing.resources.map((item) => [
      item.want.file,
      item.optional,
      item.supported,
      item.unavailable?.reason,
    ]),
    [
      ["style.safetensors", true, true, undefined],
      ["style-old.safetensors", true, false, "no-checksum"],
    ],
  );
  await assert.rejects(
    resolveHuggingFace("https://huggingface.co/org/repo", {
      request: async () => hfResponse(null, 401),
    }),
    /gated or private/,
  );
  await assert.rejects(
    resolveHuggingFace("https://huggingface.co/org/repo/blob/main/missing.safetensors", {
      request,
    }),
    /isn’t in this repository/,
  );
});

/** A safetensors file's opening bytes: the 8-byte header length, then the header. */
const safetensors = (tensors) => {
  const header = Buffer.from(
    JSON.stringify({
      __metadata__: { format: "pt" },
      ...Object.fromEntries(
        tensors.map((name) => [name, { dtype: "BF16", shape: [1], data_offsets: [0, 2] }]),
      ),
    }),
  );
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([length, header]);
};
const adapterHeader = safetensors([
  "diffusion_model.blocks.0.attn.qkv_proj.alpha",
  "diffusion_model.blocks.0.attn.qkv_proj.lora_A.weight",
  "diffusion_model.blocks.0.attn.qkv_proj.lora_B.weight",
]);
const modelHeader = safetensors(["blocks.0.attn.out_proj.weight", "blocks.0.attn.k_norm.weight"]);

test("a Hugging Face file goes where the file itself says, not where the repository's LoRA tag does", async () => {
  assert.deepEqual(
    hfFolder("diffusion_models/p-h3-image_w4a8.safetensors", { tags: ["lora"] }),
    { folder: "diffusion_models", guessed: false },
    "a diffusion_models/ path beats the repository's tag",
  );
  assert.deepEqual(hfFolder("loras/p-h3-image_lora_bf16.safetensors", { tags: ["lora"] }), {
    folder: "loras",
    guessed: false,
  });
  const header = (bytes) => JSON.parse(bytes.subarray(8).toString());
  assert.deepEqual(hfFolder("model.safetensors", { tags: ["lora"], header: header(modelHeader) }), {
    folder: "diffusion_models",
    guessed: true,
  });
  assert.deepEqual(hfFolder("model.safetensors", { header: header(adapterHeader) }), {
    folder: "loras",
    guessed: false,
  });

  // PrunaAI/P-H3-Image-Comfy: tagged `lora` for its one adapter, beside root files only headers place.
  const sha = (char) => ({ sha256: char.repeat(64), size: 4096 });
  const siblings = [
    ["diffusion_models/p-h3-image_w4a8.safetensors", "a"],
    ["text_encoders/p-h3-image_text_encoder_w4a8.safetensors", "b"],
    ["vae/p-h3-image_vae_int8_convrot.safetensors", "c"],
    ["loras/p-h3-image_lora_bf16.safetensors", "d"],
    ["style.safetensors", "e"],
    ["merged.safetensors", "f"],
  ].map(([rfilename, char]) => ({ rfilename, lfs: sha(char) }));
  const bodies = { "style.safetensors": adapterHeader, "merged.safetensors": modelHeader };
  const ranges = [];
  const request = async (url, init = {}) => {
    const range = new Headers(init.headers || {}).get("range");
    if (!range) return hfResponse({ sha: "e".repeat(40), tags: ["lora"], cardData: {}, siblings });
    const file = decodeURIComponent(String(url).split("/").pop());
    ranges.push(file);
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range).map(Number);
    return new Response(bodies[file].subarray(start, end + 1), { status: 206 });
  };
  const listing = await resolveHuggingFace("https://huggingface.co/PrunaAI/P-H3-Image-Comfy", {
    request,
  });
  assert.deepEqual(
    listing.resources.map((item) => [item.want.file, item.want.folder, item.role]),
    [
      ["p-h3-image_w4a8.safetensors", "diffusion_models", "diffusion_model"],
      ["p-h3-image_text_encoder_w4a8.safetensors", "text_encoders", "text_encoder"],
      ["p-h3-image_vae_int8_convrot.safetensors", "vae", "vae"],
      ["p-h3-image_lora_bf16.safetensors", "loras", "lora"],
      ["style.safetensors", "loras", "lora"],
      ["merged.safetensors", "diffusion_models", "diffusion_model"],
    ],
  );
  assert.deepEqual(
    [...new Set(ranges)].sort(),
    ["merged.safetensors", "style.safetensors"],
    "only files their names don't place are read",
  );
  // A server that ignores the range (and would send the whole file) leaves the tag to decide.
  const whole = await resolveHuggingFace(
    "https://huggingface.co/PrunaAI/P-H3-Image-Comfy/blob/main/merged.safetensors",
    {
      request: async (url, init = {}) =>
        new Headers(init.headers || {}).get("range")
          ? new Response(modelHeader, { status: 200 })
          : request(url, init),
    },
  );
  assert.equal(whole.resources[0].want.folder, "loras");
});
