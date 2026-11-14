import assert from "node:assert/strict";
import test from "node:test";
import { hfFetch, mirroredUrl } from "./hf-access.js";

const token = "hf_abcdefghijklmnopqrstuvwxyz1234";

test("the token goes to huggingface.co only, never along a redirect to the CDN", async () => {
  const seen = [];
  const transport = async (url, options) => {
    seen.push({ host: url.hostname, auth: options.headers.get("authorization") });
    if (url.hostname === "huggingface.co")
      return new Response(null, {
        status: 302,
        headers: { location: "https://cdn-lfs.hf.co/file?sig=1" },
      });
    return new Response("data", { status: 200 });
  };
  const response = await hfFetch(
    "https://huggingface.co/org/repo/resolve/main/a.safetensors",
    { headers: { range: "bytes=0-" } },
    { env: { HF_TOKEN: token }, transport },
  );
  assert.equal(await response.text(), "data");
  assert.deepEqual(seen, [
    { host: "huggingface.co", auth: `Bearer ${token}` },
    { host: "cdn-lfs.hf.co", auth: null },
  ]);
});

test("a mirror takes the downloads, and does not get the token", async () => {
  const env = { HF_ENDPOINT: "https://hf-mirror.com", HF_TOKEN: token };
  assert.equal(
    mirroredUrl("https://huggingface.co/org/repo/resolve/main/a.safetensors", env).href,
    "https://hf-mirror.com/org/repo/resolve/main/a.safetensors",
  );
  assert.equal(mirroredUrl("https://example.com/x", env).href, "https://example.com/x");
  const seen = [];
  await hfFetch(
    "https://huggingface.co/org/repo/resolve/main/a.safetensors",
    {},
    {
      env,
      transport: async (url, options) => {
        seen.push([url.hostname, options.headers.get("authorization")]);
        return new Response("ok");
      },
    },
  );
  assert.deepEqual(seen, [["hf-mirror.com", null]]);
});
