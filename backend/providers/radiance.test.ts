import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { RadianceClient, imageRequest, videoRequest } from "./radiance.ts";

const image = {
  model: "qwen-image-2.1-turbo-iq8r",
  prompt: "A lighthouse at dusk",
  width: 1024,
  height: 1024,
  steps: 8,
  cfg: 1,
  seed: 7,
  count: 2,
  rebalance: "off",
  loras: JSON.stringify([{ name: "styles/ink.safetensors", strength: 0.6 }]),
};

test("an image request sends its exact schedule, guidance and LoRAs", () => {
  assert.deepEqual(imageRequest(image), {
    route: "/v1/images/generations",
    body: {
      model: "qwen-image-2.1-turbo-iq8r",
      prompt: "A lighthouse at dusk",
      size: "1024x1024",
      seed: 7,
      n: 2,
      output_format: "png",
      response_format: "b64_json",
      num_inference_steps: 8,
      guidance_scale: 1,
      negative_prompt: "",
      loras: [{ name: "styles/ink", weight: 0.6 }],
    },
  });
  const edit = imageRequest(image, [new Uint8Array([1]), new Uint8Array([2])]);
  assert.equal(edit.route, "/v1/images/edits");
  assert.equal((edit.body as FormData).getAll("image[]").length, 2);
  assert.equal((edit.body as FormData).get("loras"), '[{"name":"styles/ink","weight":0.6}]');
  const masked = imageRequest(image, [new Uint8Array([1])], "", {
    mask: new Uint8Array([2]),
    transparent: true,
  }).body as FormData;
  assert.ok(masked.get("mask"));
  assert.equal(masked.get("background"), "transparent");
  assert.equal(masked.get("output_format"), "png");
  const fixed = imageRequest({ ...image, steps: undefined }, [new Uint8Array([1])]);
  assert.equal((fixed.body as FormData).has("num_inference_steps"), false);
});

test("an edit reaches Radiance as multipart fields through the default client", async () => {
  let received = "";
  const server = createServer((request, response) => {
    request.setEncoding("latin1");
    request.on("data", (chunk) => (received += chunk));
    request.on("end", () => response.end(JSON.stringify({ data: [{ b64_json: "AQ==" }] })));
  }).listen(0);
  const { port } = server.address() as { port: number };
  const { route, body } = imageRequest(image, [new Uint8Array([1])]);
  await new RadianceClient(`http://127.0.0.1:${port}`).images(
    route,
    body,
    AbortSignal.timeout(5000),
  );
  server.close();
  assert.match(received, /name="model"\r\n\r\nqwen-image-2\.1-turbo-iq8r\r\n/);
  assert.match(received, /name="image\[\]"; filename="image\[\]\.png"/);
});

test("the API key authenticates model discovery, JSON generation and multipart edits", async () => {
  const requests: RequestInit[] = [];
  const client = new RadianceClient(
    "http://radiance:8000",
    (async (_url, init) => {
      requests.push(init!);
      return Response.json({ data: [{ id: image.model, b64_json: "AQ==" }] });
    }) as typeof fetch,
    "test-api-key",
  );
  await client.models();
  await client.images("/v1/images/generations", { model: image.model }, AbortSignal.timeout(1000));
  const edit = imageRequest(image, [new Uint8Array([1])]);
  await client.images(edit.route, edit.body, AbortSignal.timeout(1000));
  for (const request of requests)
    assert.equal(new Headers(request.headers).get("authorization"), "Bearer test-api-key");
  assert.equal(new Headers(requests[1].headers).get("content-type"), "application/json");
  assert.equal(new Headers(requests[2].headers).has("content-type"), false);
  assert.equal(requests[2].body, edit.body);

  const local = new RadianceClient(
    "http://localhost:8000",
    (async (_url, init) => {
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return Response.json({ data: [] });
    }) as typeof fetch,
    "",
  );
  await local.models();
});

test("Krea 2 profiles send guidance in the card's terms, where 0 is unguided", () => {
  const guidance = (cfg: number, family: string) => {
    const { body } = imageRequest({ ...image, model: "kroma-iq8r", cfg }, [], family);
    return (body as Record<string, unknown>).guidance_scale;
  };
  assert.equal(guidance(1, "krea2"), 0);
  assert.equal(guidance(4.5, "krea2"), 3.5);
  assert.equal(guidance(1, "flux3"), 1);
});

test("a video sized for another model's area shrinks to H3's on the 32-pixel grid", () => {
  const { body } = videoRequest({
    model: "minimax-h3-i8",
    prompt: "Waves",
    width: 1024,
    height: 1024,
    frames: 192,
    steps: 30,
    seed: 1,
  });
  assert.equal((body as Record<string, unknown>).size, "992x992");
});

test("video references take their slots' roles: H3 frames or references, LTX-2.5 a first frame", () => {
  const video = { prompt: "Waves", width: 1344, height: 768, frames: 192, steps: 50, seed: 1 };
  const picture = (role?: string) => ({ bytes: new Uint8Array([1]), role });
  const fields = (model: string, images: ReturnType<typeof picture>[], extra = {}) => [
    ...(videoRequest({ ...video, model, ...extra }, images).body as FormData).keys(),
  ];
  assert.deepEqual(
    fields("minimax-h3-i8", [picture("start"), picture("end")], { latent_upscale: 2 }),
    [
      "model",
      "prompt",
      "seconds",
      "size",
      "seed",
      "num_inference_steps",
      "latent_upscale",
      "first_frame",
      "last_frame",
    ],
  );
  assert.deepEqual(fields("minimax-h3-i8", [picture(), picture("reference")]).slice(-2), [
    "ref_image_1",
    "ref_image_2",
  ]);
  assert.throws(
    () => videoRequest({ ...video, model: "minimax-h3-i8" }, [picture("start"), picture()]),
    /not both/,
  );
  // LTX-2.5: its own grid and canvas; the distilled release keeps its eight steps and reaches past
  // 960 × 544 through its latent upsampler; the base is guided.
  const ltx = { width: 1920, height: 1088, frames: 121 };
  assert.deepEqual(fields("ltx-2.5-distilled-iq8r", [picture("start")], ltx), [
    "model",
    "prompt",
    "seconds",
    "size",
    "seed",
    "latent_upscale",
    "input_reference",
  ]);
  const base = videoRequest({
    ...video,
    model: "ltx-2.5-iq8r",
    frames: 121,
    steps: 30,
    cfg: 3,
    width: 960,
    height: 544,
  }).body as Record<string, unknown>;
  assert.deepEqual(
    [base.seconds, base.size, base.num_inference_steps, base.guidance_scale, base.negative_prompt],
    ["5.041", "960x544", 30, 3, ""],
  );
  assert.throws(() => videoRequest({ ...video, model: "ltx-2.5-iq8r" }), /8n \+ 1/);
  assert.throws(
    () => videoRequest({ ...video, model: "ltx-2.5-iq8r", frames: 121 }, [picture("end")]),
    /first frame only/,
  );
});

test("the client reads model states and keeps Radiance's own words on failure", async () => {
  const answers: Record<string, Response> = {
    "/v1/models": Response.json({ data: [{ id: "krea-2-turbo-iq8r", state: "parked", tp: 1 }] }),
    "/v1/images/generations": Response.json(
      { error: { message: "Unknown model: krea-9", type: "invalid_request_error" } },
      { status: 404 },
    ),
  };
  const client = new RadianceClient(
    "http://radiance:8000/",
    (async (url: string) => answers[new URL(url).pathname]) as typeof fetch,
  );
  assert.deepEqual(await client.models(), [{ id: "krea-2-turbo-iq8r", state: "parked" }]);
  await assert.rejects(client.images("/v1/images/generations", {}, AbortSignal.timeout(1000)), {
    message: "Radiance: Unknown model: krea-9",
    status: 404,
  });
});

test("one-GPU Qwen and Noct fit their actual conditioning limits without constraining FLUX3", () => {
  for (const model of ["qwen-image-2.1-iq8r", "noctq-v4-lightning-iq8r"]) {
    // 1792 × 1024 shrinks to 1344 × 768.
    const wide = imageRequest({ ...image, model, width: 1792 }).body as { size: string };
    assert.equal(wide.size, "1344x768");
    assert.throws(
      () => imageRequest({ ...image, model }, Array(4).fill(new Uint8Array([1]))),
      /3 reference/,
    );
    // The two-GPU twin holds four references at 2048.
    const twin = imageRequest(
      { ...image, model: `${model}-refs`, width: 2048 },
      Array(4).fill(new Uint8Array([1])),
    );
    assert.equal((twin.body as FormData).get("size"), "2048x1024");
  }
  const edit = imageRequest(
    { ...image, model: "flux-3-image-klein-iq8r", width: 1408, height: 1408 },
    Array(10).fill(new Uint8Array([1])),
  );
  assert.equal((edit.body as FormData).getAll("image[]").length, 10);
});

test("Noct preserves the guide or explicit negative and CFG1 explicitly overrides native defaults", () => {
  const request = imageRequest({
    ...image,
    model: "noctq-v4-iq8r",
    cfg: 3,
    steps: 25,
    negative_prompt: "  exact entered negative  ",
  }).body as Record<string, unknown>;
  assert.equal(request.guidance_scale, 3);
  assert.equal(request.num_inference_steps, 25);
  assert.equal(request.negative_prompt, "  exact entered negative  ");
  const off = imageRequest({ ...image, model: "qwen-image-2.1-iq8r", cfg: 1 }).body as Record<
    string,
    unknown
  >;
  assert.equal(off.guidance_scale, 1);
});
