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

test("one-GPU Qwen and Noct enforce their actual conditioning limits without constraining FLUX3", () => {
  for (const model of ["qwen-image-2.1-iq8r", "noctq-v4-uncensored-iq8r"]) {
    assert.throws(() => imageRequest({ ...image, model, width: 1376 }), /1344/);
    assert.throws(
      () => imageRequest({ ...image, model }, Array(5).fill(new Uint8Array([1]))),
      /4 reference/,
    );
  }
  const edit = imageRequest(
    { ...image, model: "flux-3-klein-iq8r", width: 1408, height: 1408 },
    Array(10).fill(new Uint8Array([1])),
  );
  assert.equal((edit.body as FormData).getAll("image[]").length, 10);
});

test("Noct preserves the guide or explicit negative and CFG1 explicitly overrides native defaults", () => {
  const request = imageRequest({
    ...image,
    model: "noctq-v4-uncensored-iq8r",
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
