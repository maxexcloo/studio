import assert from "node:assert/strict";
import test from "node:test";

import { request } from "./api.ts";

function answer(...responses: (Response | Error)[]) {
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return next;
  };
  return calls;
}
const refusal = (status: number, headers: Record<string, string> = {}) =>
  Response.json({ error: "Refused." }, { status, headers });
const write = { method: "POST", body: "{}" };

test("requests resend only what Studio never handled while it restarts", async () => {
  // Writes: Studio's stopping answer and the proxy's 503 are resent; Studio's own refusal and a
  // gateway 502, which may follow a handled request, are not.
  let calls = answer(
    refusal(503, { "Retry-After": "1" }),
    new Response("no available server", { status: 503 }),
    Response.json({ ok: true }),
  );
  assert.equal((await request("/api/x", write)).status, 200);
  assert.equal(calls.length, 3);
  calls = answer(refusal(503));
  await assert.rejects(request("/api/x", write), /Refused/);
  assert.equal(calls.length, 1);
  calls = answer(new Response("Bad Gateway", { status: 502 }));
  await assert.rejects(request("/api/x", write), /restarting/);
  assert.equal(calls.length, 1);
  // Reads also ride out an unreachable Studio and a gateway 502.
  calls = answer(
    new TypeError("fetch failed"),
    new Response("", { status: 502 }),
    Response.json({}),
  );
  assert.equal((await request("/api/x")).status, 200);
  assert.equal(calls.length, 3);
});
