import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-radiance-loras-"));
process.env.STUDIO_DATA_DIR = scratch;
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { metadataFromJson, saveImportedWorkflow } = await import("./custom-workflows.js");
const { customWorkflowGraph } = await import("./graphs.js");
const { loraCatalogue } = await import("./lora/info.js");
const { prepareLoras } = await import("./mcp/controls.js");
const { inferModels } = await import("./model/models.js");
const { radianceInfo } = await import("./providers/radiance.ts");
const { fastTwin, sanitizeGenerateBody } = await import("./validation.js");

const prompt = "A lighthouse at dusk";
const raw = (loraStack, id = "radiance-loras") => ({
  graph: {
    1: {
      class_type: "RadianceImageGenerate",
      inputs: {
        model: "krea-2-turbo-bf16",
        prompt: "",
        seed: 0,
        width: 1024,
        height: 1024,
        loras: "[]",
      },
    },
  },
  studio: {
    id,
    capabilities: { lora: true },
    controls: { prompt: { node: "1", input: "prompt" }, seed: { node: "1", input: "seed" } },
    loraStack,
  },
});
saveImportedWorkflow(raw({ adapter: "radiance-tags-v1", node: "1" }));
const build = (loras) =>
  customWorkflowGraph({
    workflow: "custom:radiance-loras",
    prompt,
    seed: 7,
    width: 1024,
    height: 1024,
    loras,
  });

test("the Radiance adapter takes a stack of up to four by default, clamped to 1–8", () => {
  assert.deepEqual(metadataFromJson(raw({ adapter: "radiance-tags-v1", node: 1 })).loraStack, {
    adapter: "radiance-tags-v1",
    node: "1",
    max: 4,
  });
  assert.equal(
    metadataFromJson(raw({ adapter: "radiance-tags-v1", node: "1", max: 20 })).loraStack.max,
    8,
  );
  assert.equal(
    metadataFromJson(raw({ adapter: "radiance-tags-v1", node: "1", max: -3 })).loraStack.max,
    1,
  );
  assert.equal(
    metadataFromJson(raw({ adapter: "radiance-tags-v1", node: "1" })).capabilities.lora,
    true,
  );
  // The rgthree defaults are unchanged, and unknown adapters still connect nothing.
  assert.equal(metadataFromJson(raw({ adapter: "rgthree-power-v1", node: "1" })).loraStack.max, 8);
  assert.equal(metadataFromJson(raw({ adapter: "rgthree-stack-v1", node: "1" })).loraStack.max, 4);
  assert.equal(metadataFromJson(raw({ adapter: "radiance-tags-v2", node: "1" })).loraStack, null);
  assert.equal(metadataFromJson(raw({ adapter: "radiance-tags-v1" })).loraStack, null);
});

test("the Radiance node gets the enabled LoRAs as one JSON string, and the prompt stays as written", async () => {
  const none = await build([]);
  assert.equal(none[1].inputs.loras, "[]");
  assert.equal(none[1].inputs.prompt, prompt);
  assert.equal((await build(undefined))[1].inputs.loras, "[]");

  const one = await build([{ name: "styles/film.safetensors", enabled: true, strength: "0.8" }]);
  assert.equal(one[1].inputs.loras, '[{"name":"styles/film.safetensors","strength":0.8}]');
  assert.equal(one[1].inputs.prompt, prompt);
  assert.doesNotMatch(one[1].inputs.prompt, /<lora:/);

  const two = await build([
    { name: "b.safetensors", enabled: true, strength: 1.2 },
    { name: "off.safetensors", enabled: false, strength: 1 },
    { name: "a.safetensors", strength: -0.5 },
  ]);
  assert.deepEqual(JSON.parse(two[1].inputs.loras), [
    { name: "b.safetensors", strength: 1.2 },
    { name: "a.safetensors", strength: -0.5 },
  ]);
});

test("the Radiance stack stops at its max", async () => {
  saveImportedWorkflow(raw({ adapter: "radiance-tags-v1", node: "1", max: 2 }, "radiance-two"));
  const graph = await customWorkflowGraph({
    workflow: "custom:radiance-two",
    prompt,
    seed: 1,
    width: 1024,
    height: 1024,
    loras: ["a", "b", "c"].map((name) => ({ name: `${name}.safetensors`, strength: 1 })),
  });
  assert.deepEqual(
    JSON.parse(graph[1].inputs.loras).map((lora) => lora.name),
    ["a.safetensors", "b.safetensors"],
  );
});

test("LoRAs the profile names stay ahead of the request stack", async () => {
  const fixed = raw({ adapter: "radiance-tags-v1", node: "1" }, "radiance-fixed");
  fixed.graph[1].inputs.loras = '[{"name":"speed/lightning.safetensors","strength":1}]';
  saveImportedWorkflow(fixed);
  const graph = await customWorkflowGraph({
    workflow: "custom:radiance-fixed",
    prompt,
    seed: 1,
    width: 1024,
    height: 1024,
    loras: [{ name: "a.safetensors", strength: 0.5 }],
  });
  assert.deepEqual(JSON.parse(graph[1].inputs.loras), [
    { name: "speed/lightning.safetensors", strength: 1 },
    { name: "a.safetensors", strength: 0.5 },
  ]);
});

test("a run with LoRAs moves to the stack's model, records it, and takes the adapters that model needs first", async () => {
  const lightning = { name: "speed/lightning.safetensors", strength: 1 };
  const stack = {
    adapter: "radiance-tags-v1",
    node: "1",
    model: "krea-2-turbo-bf16",
    loras: [lightning],
  };
  const profile = raw(stack, "radiance-bf16");
  profile.studio.controls.model = { node: "1", input: "model" };
  profile.studio.defaults = { model: "krea-2-turbo-iq8r" };
  profile.graph[1].inputs.model = "krea-2-turbo-iq8r";
  loraCatalogue().edit("loras/a.safetensors", { families: ["krea2"] });
  saveImportedWorkflow(profile);
  const info = radianceInfo([{ id: "krea-2-turbo-iq8r" }], ["a.safetensors"]);
  const run = async (loras) => {
    const body = sanitizeGenerateBody(
      { workflow: "custom:radiance-bf16", model: "custom:radiance-bf16", prompt, seed: 1, loras },
      info,
    );
    return { body, graph: await customWorkflowGraph(body) };
  };
  const plain = await run([]);
  assert.equal(plain.body.modelName, "krea-2-turbo-iq8r");
  assert.equal(plain.graph[1].inputs.model, "krea-2-turbo-iq8r");
  assert.equal(plain.graph[1].inputs.loras, "[]");
  const { body, graph: styled } = await run([{ name: "a.safetensors", strength: 0.5 }]);
  assert.equal(body.modelName, "krea-2-turbo-bf16");
  assert.equal(styled[1].inputs.model, "krea-2-turbo-bf16");
  assert.deepEqual(JSON.parse(styled[1].inputs.loras), [
    lightning,
    { name: "a.safetensors", strength: 0.5 },
  ]);
});

test("Noct profiles refuse optional LoRAs and discard their fixed adapters, even with a model override", async () => {
  const id = "custom:noct-adapter";
  const lightning = { name: "qwen-image-2.1-lightning-4step", strength: 1 };
  const profile = raw(
    {
      adapter: "radiance-tags-v1",
      node: "1",
      model: "qwen-image-2.1-bf16",
      loras: [lightning],
    },
    "noct-adapter",
  );
  profile.studio.family = "qwen_image_21";
  profile.studio.controls.model = { node: "1", input: "model" };
  profile.graph[1].inputs.model = "noctq-v4-iq8r";
  profile.graph[1].inputs.loras = JSON.stringify([lightning]);
  saveImportedWorkflow(profile);
  const info = radianceInfo(
    [{ id: "noctq-v4-iq8r" }, { id: "qwen-image-2.1-bf16" }],
    ["slider.safetensors"],
  );
  const [listed] = inferModels(info).profiles.filter((entry) => entry.id === id);
  assert.equal(listed.capabilities.lora, false);
  assert.deepEqual(listed.options.loras, []);
  const body = {
    workflow: id,
    model: id,
    prompt,
    loras: [{ name: "slider.safetensors", strength: 1 }],
  };
  assert.throws(() => sanitizeGenerateBody(body, info), /takes no LoRAs on noctq-v4-iq8r/);
  assert.throws(
    () => sanitizeGenerateBody({ ...body, modelName: "qwen-image-2.1-bf16" }, info),
    /takes no LoRAs on noctq-v4-iq8r/,
  );
  const graph = await customWorkflowGraph(body);
  assert.equal(graph[1].inputs.model, "noctq-v4-iq8r");
  assert.equal(graph[1].inputs.loras, "[]");
  const overridden = await customWorkflowGraph({ ...body, modelName: "qwen-image-2.1-bf16" });
  assert.equal(overridden[1].inputs.loras, "[]");
});

test("Radiance checks catalogue families and exact base constraints against the model that runs the stack", async () => {
  const id = "custom:actual-base";
  const model = "flux-2-klein-9b-bf16";
  const zimage = "z-image-turbo-style.safetensors";
  const klein4b = "klein-4b-style.safetensors";
  const wrongBase = "klein-base-only.safetensors";
  const unknown = "unclassified.safetensors";
  const fits = "klein-compatible.safetensors";
  const infos = {
    [zimage]: { families: ["zimage"] },
    [klein4b]: { families: ["flux2_klein_4b"] },
    [wrongBase]: {
      families: ["flux2_klein_9b"],
      compatibility: { baseModels: ["flux-2-klein-9b-base-bf16"], unlisted: "other" },
    },
    [fits]: {
      compatibility: { baseModels: [model], unlisted: "other" },
    },
    [unknown]: {},
  };
  for (const [file, metadata] of Object.entries(infos))
    loraCatalogue().edit(`loras/${file}`, metadata);
  const profile = raw(
    {
      adapter: "radiance-tags-v1",
      node: "1",
      model,
      loras: [zimage, klein4b, wrongBase].map((name) => ({ name, strength: 1 })),
    },
    "actual-base",
  );
  profile.studio.family = "flux2_klein_9b";
  profile.studio.controls.model = { node: "1", input: "model" };
  profile.graph[1].inputs.model = "flux-2-klein-9b-iq8r";
  saveImportedWorkflow(profile);
  const info = radianceInfo(
    [{ id: profile.graph[1].inputs.model }, { id: model }],
    Object.keys(infos),
  );
  const body = (name) => ({ workflow: id, model: id, prompt, loras: [{ name, strength: 1 }] });
  for (const name of [zimage, klein4b])
    assert.throws(
      () => sanitizeGenerateBody(body(name), info),
      /Remove it from the optional LoRA stack/,
    );
  assert.throws(() => sanitizeGenerateBody(body(wrongBase), info), /does not support this model/);
  assert.throws(() => sanitizeGenerateBody(body(unknown), info), /no known model family/);
  const listed = inferModels(info).profiles.find((entry) => entry.id === id);
  const notes = [];
  assert.deepEqual(prepareLoras(listed, infos, [{ name: wrongBase }], notes), []);
  assert.match(notes[0], /does not support .*base model/);
  const candidate = sanitizeGenerateBody(body(fits), info);
  assert.equal(candidate.modelName, model);
  assert.deepEqual(JSON.parse((await customWorkflowGraph(candidate))[1].inputs.loras), [
    { name: fits, strength: 1 },
  ]);
});

test("a size and references one card can't hold move to the model's two-GPU twin where the worker lists one", () => {
  const profile = raw(undefined, "radiance-refs");
  profile.studio.controls.model = { node: "1", input: "model" };
  profile.studio.defaults = { model: "noctq-v4-iq8r" };
  profile.graph[1].inputs.model = "noctq-v4-iq8r";
  const slots = [1, 2, 3, 4];
  profile.studio.mediaInputs = slots.map((n) => ({
    id: `ref-${n}`,
    control: { node: "1", input: `images.image_${n}` },
  }));
  saveImportedWorkflow(profile);
  const twin = ["noctq-v4-iq8r", "noctq-v4-iq8r-refs"];
  const run = (count, models, side = 1024) =>
    sanitizeGenerateBody(
      {
        workflow: "custom:radiance-refs",
        model: "custom:radiance-refs",
        prompt,
        seed: 1,
        width: side,
        height: side,
        referenceAssets: slots
          .slice(0, count)
          .map((n) => ({ slot: `ref-${n}`, assetId: `asset-${n}` })),
      },
      radianceInfo(models.map((id) => ({ id }))),
    ).modelName;
  // One card holds three references at up to 1344 a side.
  assert.equal(run(3, twin, 1344), "noctq-v4-iq8r");
  assert.equal(run(4, twin), "noctq-v4-iq8r-refs");
  assert.equal(run(0, twin, 2048), "noctq-v4-iq8r-refs");
  assert.equal(run(4, ["noctq-v4-iq8r"]), "noctq-v4-iq8r");
});

test("three or more pictures may take the model's two-GPU copy where the worker lists one", () => {
  const profile = raw(undefined, "fast");
  profile.studio.controls.model = { node: "1", input: "model" };
  profile.studio.defaults = { model: "krea-2-turbo-iq8r" };
  profile.graph[1].inputs.model = "krea-2-turbo-iq8r";
  saveImportedWorkflow(profile);
  const twin = (count, models) => {
    const info = radianceInfo(models.map((id) => ({ id })));
    const body = sanitizeGenerateBody(
      { workflow: "custom:fast", model: "custom:fast", prompt, seed: 1, count },
      info,
    );
    return fastTwin(body, info);
  };
  const listed = ["krea-2-turbo-iq8r", "krea-2-turbo-iq8r-fast"];
  assert.equal(twin(3, listed), "krea-2-turbo-iq8r-fast");
  assert.equal(twin(2, listed), "");
  assert.equal(twin(4, ["krea-2-turbo-iq8r"]), "");
  assert.equal(twin(4, ["krea-2-turbo-iq8r", "krea-2-turbo-iq8r-refs"]), "krea-2-turbo-iq8r-refs");
});

test("rebalance runs at the profile's default where it maps one, and nowhere else", async () => {
  const profile = raw(undefined, "radiance-rebalance");
  profile.graph[1].inputs.rebalance = "off";
  profile.studio.controls.rebalance = { node: "1", input: "rebalance" };
  profile.studio.defaults = { rebalance: "balanced" };
  saveImportedWorkflow(profile);
  const info = radianceInfo([{ id: "krea-2-turbo-bf16" }]);
  const run = (workflow, rebalance) =>
    sanitizeGenerateBody({ workflow, model: workflow, prompt, seed: 1, rebalance }, info);
  const body = run("custom:radiance-rebalance");
  assert.equal(body.rebalance, "balanced");
  assert.equal((await customWorkflowGraph(body))[1].inputs.rebalance, "balanced");
  assert.equal(run("custom:radiance-rebalance", "legacy").rebalance, "legacy");
  assert.throws(() => run("custom:radiance-rebalance", "loud"), /supported rebalance/);
  assert.equal(run("custom:radiance-loras", "legacy").rebalance, "");
});
