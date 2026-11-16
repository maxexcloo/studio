import assert from "node:assert/strict";
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

test("an image request sends LoRAs in its loras field and leaves turbo's schedule alone", () => {
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
      loras: [{ name: "styles/ink", weight: 0.6 }],
    },
  });
  const edit = imageRequest(image, [new Uint8Array([1]), new Uint8Array([2])]);
  assert.equal(edit.route, "/v1/images/edits");
  assert.equal((edit.body as FormData).getAll("image[]").length, 2);
  assert.equal((edit.body as FormData).get("loras"), '[{"name":"styles/ink","weight":0.6}]');
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
