import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-radiance-inventory-"));
process.env.STUDIO_DATA_DIR = scratch;
const requests = [];
const server = http.createServer((req, res) => {
  requests.push(req.url);
  res.setHeader("content-type", "application/json");
  if (req.url === "/v1/models")
    res.end(JSON.stringify({ data: [{ id: "krea-2-turbo-iq8r", state: "cold" }] }));
  else {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
process.env.STUDIO_WORKERS = JSON.stringify([
  { id: "primary", url: `${url}/comfy`, capabilities: ["image", "models"] },
  { id: "radiance", url, backend: "radiance", capabilities: ["image", "video"] },
]);
test.after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const { saveImportedWorkflow } = await import("./custom-workflows.js");
const { customWorkflowGraph } = await import("./graphs.js");
const { loraCatalogue, loraInfos } = await import("./lora/info.js");
const { withLoraTriggers } = await import("./lora/prompts.js");
const { createModelCatalogue } = await import("./model/catalogue.js");
const { imageRequest, radianceInfo } = await import("./providers/radiance.ts");
const { sanitizeGenerateBody } = await import("./validation.js");

test("a cold Radiance profile retains installed LoRAs and catalogue triggers without waking another model or worker", async () => {
  const name = "styles/ink.safetensors";
  const model = "krea-2-turbo-iq8r";
  const defaults = { model, width: 1024, height: 1024, steps: 8, cfg: 1, count: 1 };
  saveImportedWorkflow({
    studio: {
      id: "radiance-inventory",
      kind: "image",
      family: "krea2",
      defaults,
      capabilities: { cfg: false, steps: false, lora: true },
      controls: Object.fromEntries(
        ["model", "prompt", "width", "height", "seed", "count"].map((input) => [
          input,
          { node: "1", input },
        ]),
      ),
      loraStack: { adapter: "radiance-tags-v1", node: "1", max: 4 },
    },
    graph: {
      1: {
        class_type: "RadianceImageGenerate",
        inputs: { ...defaults, prompt: "", seed: 0, loras: "[]" },
      },
      2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "studio" } },
    },
  });
  loraCatalogue().edit(`loras/${name}`, { families: ["krea2"], triggers: ["ink"] });
  const installed = { LoraLoader: { input: { required: { lora_name: [[name]] } } } };
  const store = {
    workerModels: (id) => (id === "primary" ? { info: installed } : undefined),
    saveWorkerModels: () => {},
  };
  const context = await createModelCatalogue({ store }).loadComfyContext("radiance");
  const input = {
    workflow: "custom:radiance-inventory",
    model: "custom:radiance-inventory",
    prompt: "A lighthouse",
    seed: 7,
    loras: [{ name, strength: 0.8 }],
  };
  const body = sanitizeGenerateBody(input, context.info, context.stats);
  assert.equal(body.loras.length, 1);
  assert.equal(body.loras[0].name, name);
  assert.equal(body.loras[0].enabled, true);
  assert.ok(Math.abs(body.loras[0].strength - 0.8) < 1e-10);
  const infos = await loraInfos("radiance", [name]);
  body.prompt = withLoraTriggers(body.prompt, body.loras, infos);
  assert.equal(body.prompt, "ink, A lighthouse");
  const graph = await customWorkflowGraph(body);
  assert.deepEqual(imageRequest(graph[1].inputs).body.loras, [
    { name: "styles/ink", weight: body.loras[0].strength },
  ]);
  assert.deepEqual(requests, ["/v1/models"]);
  assert.throws(
    () => sanitizeGenerateBody(input, radianceInfo([{ id: model, state: "cold" }])),
    /no LoRA inventory/,
  );
});

test("explicit LoKr deferral survives catalogue metadata and rejects enabled stacks without disabling plain adapters", async () => {
  const { optionalLoraPolicyIssue } = await import("./lora/catalogue.js");
  const file = "snofs_krea_v1_6.safetensors";
  const reason = "Deferred pending exact LoKr path verification";
  loraCatalogue().edit(`loras/${file}`, { families: ["krea2"], unavailableReason: reason });
  const info = (await loraInfos("radiance", [file]))[file];
  assert.equal(info.unavailableReason, reason);
  // Only Radiance's composed adapter is deferred; ComfyUI loads the same file exactly.
  assert.match(
    optionalLoraPolicyIssue({ name: file, strength: 1 }, info, {
      family: "krea2",
      loraStack: { adapter: "radiance-tags-v1" },
    }),
    /Deferred pending exact LoKr/,
  );
  assert.equal(
    optionalLoraPolicyIssue({ name: file, strength: 1 }, info, {
      family: "krea2",
      loraStack: { adapter: "rgthree-power-v1" },
    }),
    "",
  );
  assert.equal(
    optionalLoraPolicyIssue(
      { name: "plain", strength: 1 },
      { families: ["krea2"] },
      { family: "krea2" },
    ),
    "",
  );
  const input = {
    workflow: "custom:radiance-inventory",
    model: "custom:radiance-inventory",
    prompt: "A lighthouse",
    loras: [{ name: file, strength: 1 }],
  };
  const nodes = radianceInfo([{ id: "krea-2-turbo-iq8r", state: "cold" }], [file]);
  assert.throws(() => sanitizeGenerateBody(input, nodes), /Deferred pending exact LoKr/);
  assert.deepEqual(
    sanitizeGenerateBody({ ...input, loras: [{ name: file, enabled: false, strength: 1 }] }, nodes)
      .loras,
    [],
  );
  loraCatalogue().edit(`loras/${file}`, { unavailableReason: null });
  assert.equal((await loraInfos("radiance", [file]))[file].unavailableReason, undefined);
});

test("Radiance catalogue distinguishes failed models from cold models and exposes one-GPU Qwen size bounds", async () => {
  const { inferModels } = await import("./model/models.js");
  const model = "qwen-image-2.1-iq8r";
  saveImportedWorkflow({
    studio: {
      id: "qwen-bounds",
      kind: "image",
      family: "qwen_image_21",
      defaults: { model, width: 1344, height: 1344 },
      controls: Object.fromEntries(
        ["model", "prompt", "width", "height"].map((input) => [input, { node: "1", input }]),
      ),
    },
    graph: {
      1: { class_type: "RadianceImageGenerate", inputs: { model } },
      2: { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    },
  });
  const nodes = radianceInfo([{ id: model, state: "cold" }]);
  const cold = inferModels(nodes, { radiance: [{ id: model, state: "cold" }] }).profiles.find(
    (item) => item.id === "custom:qwen-bounds",
  );
  assert.notEqual(cold.ready, false);
  assert.equal(cold.constraints.width.max, 1344);
  assert.equal(cold.constraints.height.max, 1344);
  const failed = inferModels(nodes, { radiance: [{ id: model, state: "failed" }] }).profiles.find(
    (item) => item.id === "custom:qwen-bounds",
  );
  assert.equal(failed, undefined, "a failed model is not offered as ready");
});

test("a Radiance profile that loads reference images is offered", async () => {
  const { inferModels } = await import("./model/models.js");
  const model = "qwen-image-2.1-turbo-iq8r";
  saveImportedWorkflow({
    studio: {
      id: "qwen-references",
      kind: "image",
      family: "qwen_image_21",
      defaults: { model, width: 1344, height: 1344 },
      controls: Object.fromEntries(
        ["model", "prompt", "width", "height"].map((input) => [input, { node: "1", input }]),
      ),
      mediaInputs: [
        {
          id: "reference",
          kind: "image",
          label: "Reference Image",
          required: false,
          control: { input: "image", node: "3" },
          max: 1,
          min: 0,
        },
      ],
    },
    graph: {
      1: {
        class_type: "RadianceImageGenerate",
        inputs: { model, "images.image_1": ["3", 0] },
      },
      2: { class_type: "SaveImage", inputs: { images: ["1", 0] } },
      3: { class_type: "LoadImage", inputs: { image: "reference.png" } },
    },
  });
  const nodes = radianceInfo([{ id: model, state: "cold" }]);
  const offered = inferModels(nodes, { radiance: [{ id: model, state: "cold" }] }).profiles.find(
    (item) => item.id === "custom:qwen-references",
  );
  assert.ok(offered, "LoadImage is a node Studio fills itself");
});
