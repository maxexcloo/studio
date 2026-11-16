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
  for (const backend of ["comfyui", "radiance"])
    assert.match(
      optionalLoraPolicyIssue({ name: file, strength: 1 }, info, { family: "krea2", backend }),
      /Deferred pending exact LoKr/,
    );
  assert.equal(
    optionalLoraPolicyIssue(
      { name: "plain", strength: 1 },
      { families: ["krea2"] },
      { family: "krea2" },
    ),
    "",
  );
  loraCatalogue().edit(`loras/${file}`, { unavailableReason: null });
  assert.equal((await loraInfos("radiance", [file]))[file].unavailableReason, undefined);
});
