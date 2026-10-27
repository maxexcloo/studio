import "./fixtures/local-worker.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { isComfyTimeout, noteComfyFetchError, noteComfyReachable } from "./comfy.js";
import { diagnostics, diagnosticsText } from "./diagnostics.js";

/** What a check to `url` throws, cut short after `ms`. */
async function checkError(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    await fetch(url, { signal: controller.signal });
    return null;
  } catch (error) {
    return error;
  } finally {
    clearTimeout(timer);
  }
}

test("a ComfyUI that answers late reads as a timeout, one that has stopped does not", async () => {
  const busy = http.createServer((_req, res) => setTimeout(() => res.end("{}"), 2000));
  await new Promise((resolve) => busy.listen(0, "127.0.0.1", resolve));
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const closedPort = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  try {
    assert.equal(
      isComfyTimeout(await checkError(`http://127.0.0.1:${busy.address().port}/system_stats`, 200)),
      true,
    );
    const refused = await checkError(`http://127.0.0.1:${closedPort}/system_stats`, 2000);
    assert.ok(refused);
    assert.equal(isComfyTimeout(refused), false);
    assert.equal(
      isComfyTimeout(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" })),
      true,
    );
  } finally {
    busy.closeAllConnections();
    await new Promise((resolve) => busy.close(resolve));
  }
});

test("a bug report tells a busy ComfyUI from one that is not answering", () => {
  assert.match(
    diagnosticsText(diagnostics({ version: "0.18.0", stats: null, comfyBusy: true })),
    /ComfyUI: busy, no answer within 10 s \(on this computer\)/,
  );
  assert.match(
    diagnosticsText(diagnostics({ version: "0.18.0", stats: null })),
    /ComfyUI: not answering \(on this computer\)/,
  );
});

test("outage logs skip busy timeouts and say refused or unreachable", (t) => {
  const lines = [];
  t.mock.method(console, "error", (line) => lines.push(String(line)));
  noteComfyReachable();
  lines.length = 0;
  // A timed-out check is a busy ComfyUI, not an outage.
  noteComfyFetchError(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
  assert.deepEqual(lines, []);
  // A refusal is one, and the log says which kind.
  const refused = new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  noteComfyFetchError(refused);
  assert.match(lines.join("\n"), /ComfyUI stopped answering .*"code":"ECONNREFUSED"/);
  noteComfyReachable();
  assert.match(lines.at(-1), /ComfyUI answering again/);
});
