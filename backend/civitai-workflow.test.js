import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { civitaiGenerationData } from "./civitai-access.js";
import { importCivitaiImage, matchResources, versionResource } from "./civitai-import.js";
import { sameResourceFilename, workflowModelSources } from "./civitai-workflow.js";

const hash = "a".repeat(64);
const revision = "b".repeat(40);
// Redacted public image 143425442: nested ComfyUI data, no REST version IDs,
// explicit model-part provenance and an extensionless LoRA with strength 15.
const parts = [
  ["UNETLoader", "diffusion_models", "qwen_image_2.1_int8_convrot.safetensors"],
  ["CLIPLoader", "text_encoders", "qwen3vl_8b_int8_convrot.safetensors"],
  ["VAELoader", "vae", "qwen_image_2.1_vae_bf16.safetensors"],
];
const nodes = parts.map(([type, directory, name]) => ({
  type,
  widgets_values: [`qwen image 2.1\\${name}`],
  properties: {
    models: [
      {
        name,
        directory,
        url: `https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/${directory}/${name}`,
      },
    ],
  },
}));
const source = {
  id: 143425442,
  type: "image",
  width: 832,
  height: 1248,
  modelVersionIds: [],
  meta: {
    id: 143425442,
    meta: {
      prompt: "A landscape",
      models: ["qwen image 2.1\\qwen_image_2.1_int8_convrot.safetensors"],
      vaes: ["qwen image 2.1\\qwen_image_2.1_vae_bf16.safetensors"],
      additionalResources: [{ name: "style_slider", type: "lora", strength: 15 }],
      comfy: JSON.stringify({ workflow: { nodes } }),
    },
  },
};
const lora = {
  id: 3346363,
  modelId: 2954355,
  model: { type: "LORA", name: "Test Style Slider" },
  files: [
    {
      id: 17,
      type: "Model",
      name: "style_slider.safetensors",
      primary: true,
      hashes: { SHA256: hash },
    },
  ],
};
const model = {
  id: 3352534,
  modelId: 2954443,
  model: { type: "Checkpoint", name: "Qwen Image 2.1" },
  files: [
    {
      id: 21,
      type: "Diffusion Model",
      name: "qwen_bf16.safetensors",
      primary: true,
      hashes: { SHA256: "c".repeat(64) },
    },
    { id: 22, type: "Diffusion Model", name: "qwen_int8.safetensors", hashes: { SHA256: hash } },
    { id: 23, type: "Text Encoder", name: "encoder.safetensors", hashes: { SHA256: hash } },
  ],
};

test("the public generation page supplies exact associations only for the requested image", async () => {
  const state = {
    props: {
      pageProps: {
        trpcState: {
          json: {
            queries: [
              {
                queryKey: [["image", "getGenerationData"], { input: { id: source.id } }],
                state: {
                  data: { resources: [{ modelVersionId: lora.id }, { modelVersionId: model.id }] },
                },
              },
            ],
          },
        },
      },
    },
  };
  const html = `<script type="application/json" id="__NEXT_DATA__">${JSON.stringify(state)}</script>`;
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    return new Response(html);
  };
  assert.equal((await civitaiGenerationData(source.id, { request })).resources.length, 2);
  assert.equal(await civitaiGenerationData(42, { request }), null);
  assert.deepEqual(calls, [
    `https://civitai.com/images/${source.id}`,
    "https://civitai.com/images/42",
  ]);
});

test("workflow sources require an allowlisted exact loader file and directory", () => {
  assert.equal(workflowModelSources(source.meta.meta).length, 3);
  for (const patch of [
    { url: "https://evil.example/model.safetensors" },
    { url: "https://huggingface.co.evil.example/model.safetensors" },
    { url: nodes[0].properties.models[0].url + "?token=private" },
    { name: "another.safetensors" },
    { directory: "loras" },
  ]) {
    const modified = structuredClone(nodes[0]);
    Object.assign(modified.properties.models[0], patch);
    assert.deepEqual(workflowModelSources({ comfy: { workflow: { nodes: [modified] } } }), []);
  }
  assert.deepEqual(workflowModelSources({ comfy: "not json" }), []);
});

test("nested ComfyUI import resolves exact source variants, all parts and the associated LoRA strength", async () => {
  const resolved = [];
  const preset = await importCivitaiImage(`https://civitai.red/images/${source.id}`, {
    generation: async () => ({
      resources: [{ modelVersionId: lora.id }, { modelVersionId: model.id }],
    }),
    json: async (url) =>
      url.startsWith("images?")
        ? { items: [source] }
        : url.endsWith(String(lora.id))
          ? lora
          : model,
    resolveSource: async (url, folder) => {
      resolved.push({ url, folder });
      const file = url.split("/").at(-1);
      return {
        id: `hf:${folder}:${file}`,
        file,
        folder,
        url: url.replace("/main/", `/${revision}/`),
        sha256: hash,
        bytes: 123,
      };
    },
  });
  assert.equal(resolved.length, 3);
  assert.deepEqual(
    preset.resources.map((resource) => resource.folder),
    ["diffusion_models", "text_encoders", "vae", "loras"],
  );
  assert.equal(preset.resources.find((resource) => resource.folder === "loras").weight, 15);
  assert.equal(preset.resources.find((resource) => resource.folder === "loras").versionId, lora.id);
  assert.equal(preset.resources[0].file, parts[0][2]);
  assert.ok(!preset.resources.some((resource) => resource.file === "qwen_bf16.safetensors"));
  assert.ok(
    preset.resources.every((resource) => resource.supported && resource.spec.sha256 === hash),
  );
  assert.ok(
    preset.resources
      .filter((resource) => resource.folder !== "loras")
      .every((resource) => resource.sourceUrl.includes(`/resolve/${revision}/`)),
  );
  assert.ok(!preset.resources.some((resource) => resource.nameOnly));
});

test("unavailable source provenance stays explicit and cannot create a speculative download", async () => {
  const preset = await importCivitaiImage(`https://civitai.red/images/${source.id}`, {
    generation: async () => {
      throw new Error("unavailable");
    },
    json: async () => ({ items: [source] }),
    resolveSource: async () => {
      throw new Error("unverified");
    },
  });
  assert.ok(
    preset.resources.every(
      (resource) => resource.nameOnly && !resource.supported && !resource.spec,
    ),
  );
  assert.ok(preset.warnings.some((warning) => /could not be verified/.test(warning)));
  assert.equal(preset.resources.find((resource) => resource.folder === "loras").weight, 15);
});

test("diffusion model versions use the provider file type and correct destination", () => {
  const resource = versionResource(model);
  assert.equal(resource.folder, "diffusion_models");
  assert.equal(resource.spec.folder, "diffusion_models");
  assert.equal(new URL(resource.spec.url).searchParams.get("type"), "Diffusion Model");
  for (const [type, folder] of [
    ["Diffusion Model", "diffusion_models"],
    ["Text Encoder", "text_encoders"],
    ["VAE", "vae"],
  ]) {
    const typed = versionResource({
      ...model,
      model: { type },
      files: [{ id: 1, type, name: "part.safetensors", hashes: { SHA256: hash } }],
    });
    assert.equal(typed.spec.folder, folder);
    assert.equal(new URL(typed.spec.url).searchParams.get("type"), type);
  }
});

test("a recorded workflow never hides an unrelated named or catalogue model", async () => {
  const different = structuredClone(source);
  different.meta.meta.models = ["unrelated.safetensors"];
  const preset = await importCivitaiImage(`https://civitai.red/images/${source.id}`, {
    generation: async () => ({ resources: [{ modelVersionId: model.id }] }),
    json: async (url) =>
      url.startsWith("images?") ? { items: [different] } : { ...model, files: [model.files[0]] },
    resolveSource: async (url, folder) => ({
      id: `hf:${folder}`,
      file: url.split("/").at(-1),
      folder,
      sha256: hash,
    }),
  });
  const linked = preset.resources.find((resource) => resource.versionId === model.id);
  assert.equal(linked.supported, false);
  assert.equal(linked.spec, null);
  assert.match(linked.note, /does not match/);
  assert.ok(
    preset.resources.some(
      (resource) => resource.nameOnly && resource.file === "unrelated.safetensors",
    ),
  );
});

test("generation associations remain available when REST metadata has no resource names or IDs", async () => {
  const preset = await importCivitaiImage(`https://civitai.red/images/${source.id}`, {
    generation: async () => ({ resources: [{ modelVersionId: lora.id, strength: 0.4 }] }),
    json: async (url) => (url.startsWith("images?") ? { items: [{ ...source, meta: {} }] } : lora),
  });
  assert.equal(preset.resources.length, 1);
  assert.equal(preset.resources[0].versionId, lora.id);
  assert.equal(preset.resources[0].weight, 0.4);
});

test("extensionless names match local LoRAs and split model parts retain exact hash associations", async () => {
  assert.equal(sameResourceFilename("folder\\style_slider", "style_slider.safetensors"), true);
  assert.equal(sameResourceFilename("model.safetensors", "model.gguf"), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-import-parts-"));
  const bytes = Buffer.from("public fixture weights");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  try {
    for (const name of ["model.safetensors", "encoder.safetensors", "style_slider.safetensors"])
      fs.writeFileSync(path.join(dir, name), bytes);
    const result = await matchResources(
      {
        resources: [
          { folder: "diffusion_models", file: "model.safetensors", supported: true, sha256 },
          { folder: "text_encoders", file: "encoder.safetensors", supported: true, sha256 },
          { folder: "loras", file: "style_slider", nameOnly: true, weight: 15 },
        ],
      },
      {
        profiles: [{ id: "exact-model", kind: "image", model: "model.safetensors" }],
        textEncoders: ["encoder.safetensors"],
        loras: ["style_slider.safetensors"],
      },
      { foldersFor: () => [dir] },
    );
    assert.deepEqual(
      result.resources.map((resource) => resource.status),
      ["installed", "installed", "installed"],
    );
    assert.equal(result.resources[0].profileId, "exact-model");
    assert.equal(result.resources[2].localName, "style_slider.safetensors");
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});
