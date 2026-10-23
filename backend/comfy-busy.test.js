import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { comfyBusyGraceMs, isComfyTimeout, noteComfyReachable, noteComfySilent } from "./comfy.js";
import { diagnostics, diagnosticsText } from "./diagnostics.js";

/** What a status check to `url` throws, cut short after `ms` the way the status route does it. */
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

test("busy lasts as long as a run would wait, from when ComfyUI went quiet", () => {
  noteComfyReachable();
  const start = 1_000_000;
  const first = noteComfySilent(start, start + 8000);
  assert.deepEqual({ busy: first.busy, first: first.first }, { busy: true, first: true });
  // Later checks count from the first unanswered one, not from their own.
  const later = noteComfySilent(start + comfyBusyGraceMs - 5000, start + comfyBusyGraceMs - 1);
  assert.deepEqual({ busy: later.busy, first: later.first }, { busy: true, first: false });
  assert.equal(
    noteComfySilent(start + comfyBusyGraceMs, start + comfyBusyGraceMs + 8000).busy,
    false,
  );
});

test("any answer, including a run's progress, starts the quiet clock over", () => {
  noteComfyReachable();
  const start = 2_000_000;
  noteComfySilent(start, start + 8000);
  noteComfyReachable();
  const again = noteComfySilent(
    start + comfyBusyGraceMs + 10_000,
    start + comfyBusyGraceMs + 18_000,
  );
  assert.deepEqual({ busy: again.busy, first: again.first }, { busy: true, first: true });
  noteComfyReachable();
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

test("one backend answering does not reset another backend's busy grace", async () => {
  const { withComfyBackend } = await import("./comfy-backends.js");
  const at = 3_000_000;
  withComfyBackend("video", () => {
    noteComfyReachable();
    assert.equal(noteComfySilent(at, at + 100).first, true);
  });
  withComfyBackend("primary", () => noteComfyReachable());
  withComfyBackend("video", () => {
    assert.equal(noteComfySilent(at + 1000, at + comfyBusyGraceMs).busy, false);
    noteComfyReachable();
  });
});
