import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { heissAnswersAt, listenWithFallback, probeHost } from "./launch.js";

const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1", () => resolve(server));
});

test("a port another program holds moves Studio to the next free one", async () => {
  const other = await listen((_req, res) => res.end("not heiss"));
  const taken = other.address().port;
  try {
    const { server, port, moved } = await listenWithFallback((_req, res) => res.end("heiss"), { port: taken, host: "127.0.0.1" });
    assert.equal(moved, true);
    assert.ok(port > taken && port <= taken + 9);
    server.close();
    await assert.rejects(listenWithFallback(() => {}, { port: taken, host: "127.0.0.1", fallback: false }), { code: "EADDRINUSE" });
  } finally {
    other.close();
  }
});

test("a port Studio itself holds means it is already running, not a reason to start another", async () => {
  const running = await listen((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url === "/api/ping" ? { ok: true, app: "heiss-ui" } : {}));
  });
  const port = running.address().port;
  try {
    assert.equal(await heissAnswersAt(port), true);
    await assert.rejects(listenWithFallback(() => {}, { port, host: "127.0.0.1" }), (error) => error.heissRunning === true && error.port === port);
  } finally {
    running.close();
  }
});

test("an older Studio without the ping route is still recognised", async () => {
  const older = await listen((_req, res) => {
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: "Unknown API route. Restart Studio if it was just updated." }));
  });
  const other = await listen((_req, res) => res.end("<html>something else</html>"));
  try {
    assert.equal(await heissAnswersAt(older.address().port), true);
    assert.equal(await heissAnswersAt(other.address().port), false);
  } finally {
    older.close();
    other.close();
  }
});

// Is there an IPv6 loopback to listen on? (Some containers have none.)
const ipv6 = await new Promise((resolve) => {
  const probe = http.createServer();
  probe.once("error", () => resolve(false));
  probe.listen(0, "::1", () => probe.close(() => resolve(true)));
});

test("with HOST set to one address, the already-running check asks that address", { skip: !ipv6 && "no IPv6 loopback here" }, async () => {
  assert.equal(probeHost("0.0.0.0"), "127.0.0.1");
  assert.equal(probeHost("::"), "127.0.0.1");
  assert.equal(probeHost(""), "127.0.0.1");
  assert.equal(probeHost("192.168.1.20"), "192.168.1.20");
  assert.equal(probeHost("[::1]"), "::1");
  // HEISS UI listening on one address only: nothing answers for it on 127.0.0.1.
  const running = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url === "/api/ping" ? { ok: true, app: "heiss-ui" } : {}));
  });
  await new Promise((resolve) => running.listen(0, "::1", resolve));
  const port = running.address().port;
  try {
    assert.equal(await heissAnswersAt(port), false);
    assert.equal(await heissAnswersAt(port, { host: "::1" }), true);
    await assert.rejects(listenWithFallback(() => {}, { port, host: "::1" }), (error) => error.heissRunning === true && error.port === port && error.host === "::1");
  } finally {
    running.close();
  }
});
