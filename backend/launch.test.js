import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { studioAnswersAt, listenOnPort, probeHost } from "./launch.js";

const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
const pingAnswer = (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(req.url === "/api/ping" ? { ok: true, app: "studio" } : {}));
};

test("a port another program holds stops Studio with the listen error", async () => {
  const other = await listen((_req, res) => res.end("<html>something else</html>"));
  const taken = other.address().port;
  try {
    assert.equal(await studioAnswersAt(taken), false);
    await assert.rejects(
      listenOnPort(() => {}, { port: taken, host: "127.0.0.1" }),
      (error) => error.code === "EADDRINUSE" && !error.studioRunning,
    );
  } finally {
    other.close();
  }
});

test("a port Studio itself holds means it is already running, not a reason to start another", async () => {
  const running = await listen(pingAnswer);
  const port = running.address().port;
  try {
    assert.equal(await studioAnswersAt(port), true);
    await assert.rejects(
      listenOnPort(() => {}, { port, host: "127.0.0.1" }),
      (error) => error.studioRunning === true && error.port === port,
    );
  } finally {
    running.close();
  }
});

// Is there an IPv6 loopback to listen on? (Some containers have none.)
const ipv6 = await new Promise((resolve) => {
  const probe = http.createServer();
  probe.once("error", () => resolve(false));
  probe.listen(0, "::1", () => probe.close(() => resolve(true)));
});

test(
  "with HOST set to one address, the already-running check asks that address",
  { skip: !ipv6 && "no IPv6 loopback here" },
  async () => {
    assert.equal(probeHost("0.0.0.0"), "127.0.0.1");
    assert.equal(probeHost("::"), "127.0.0.1");
    assert.equal(probeHost(""), "127.0.0.1");
    assert.equal(probeHost("192.168.1.20"), "192.168.1.20");
    assert.equal(probeHost("[::1]"), "::1");
    // Studio listening on one address only: nothing answers for it on 127.0.0.1.
    const running = http.createServer(pingAnswer);
    await new Promise((resolve) => running.listen(0, "::1", resolve));
    const port = running.address().port;
    try {
      assert.equal(await studioAnswersAt(port), false);
      assert.equal(await studioAnswersAt(port, { host: "::1" }), true);
      await assert.rejects(
        listenOnPort(() => {}, { port, host: "::1" }),
        (error) => error.studioRunning === true && error.port === port && error.host === "::1",
      );
    } finally {
      running.close();
    }
  },
);

test("an idle connection outlives a reverse proxy's pooled one, so a POST after a pause is answered", async () => {
  const { server, port } = await listenOnPort(
    (_req, res) => res.end(JSON.stringify({ ok: true })),
    { port: 0, host: "127.0.0.1" },
  );
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const post = () =>
    new Promise((resolve, reject) => {
      const request = http.request(
        { host: "127.0.0.1", port, method: "POST", path: "/api/prompts/enabled", agent },
        (response) => {
          response.resume();
          response.on("end", () => resolve(request.socket));
        },
      );
      request.on("error", reject);
      request.end("{}");
    });
  try {
    const first = await post();
    // Traefik reuses idle upstream connections for up to 90 seconds without checking them.
    assert.ok(server.keepAliveTimeout > 90_000);
    assert.ok(server.headersTimeout > server.keepAliveTimeout);
    assert.equal(await post(), first, "the second POST reuses the pooled connection");
  } finally {
    agent.destroy();
    server.close();
  }
});
