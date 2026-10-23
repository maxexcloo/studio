import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { RuntimeController } from "./controller.ts";
import { createTextAdmissionRouter } from "./routes.ts";

test("Bifrost-compatible streaming request calls direct Radiance and holds admission until output drains", async (context) => {
  const controller = new RuntimeController(
    { running: async () => true, start: async () => {}, stop: async () => {} },
    [
      {
        id: "text",
        container: "radiance",
        devices: ["0"],
        kind: "text",
        url: "http://radiance.internal:8000",
      },
    ],
  );
  let releaseStream: (() => void) | undefined;
  const source = new ReadableStream({
    start(stream) {
      stream.enqueue(
        new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
      );
      releaseStream = () => {
        stream.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        stream.close();
      };
    },
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/local-text",
    createTextAdmissionRouter({
      controller,
      workloadId: "text",
      apiKey: "fixture-radiance-key",
      fetchImpl: (async (url, options) => {
        assert.equal(url, "http://radiance.internal:8000/v1/chat/completions");
        assert.equal(
          (options?.headers as Record<string, string>).Authorization,
          "Bearer fixture-radiance-key",
        );
        assert.deepEqual(JSON.parse(options?.body as string), {
          model: "local",
          stream: true,
          messages: [{ role: "user", content: "Hello" }],
        });
        return new Response(source, { headers: { "Content-Type": "text/event-stream" } });
      }) as typeof fetch,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await once(server, "listening");
  const address = server.address() as { port: number };
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/local-text/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer gateway-key" },
      body: JSON.stringify({
        model: "local",
        stream: true,
        messages: [{ role: "user", content: "Hello" }],
      }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(controller.status()[0].acceptedOperations, 1);
  releaseStream!();
  assert.match(await response.text(), /data: \[DONE\]/);
  assert.equal(controller.status()[0].acceptedOperations, 0);
});

test("caller disconnect aborts upstream streaming and releases admission", async (context) => {
  const controller = new RuntimeController(
    { running: async () => true, start: async () => {}, stop: async () => {} },
    [
      {
        id: "text",
        container: "radiance",
        devices: ["0"],
        kind: "text",
        url: "http://radiance.internal:8000",
      },
    ],
  );
  let markReleased: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    markReleased = resolve;
  });
  const acquire = controller.acquire.bind(controller);
  controller.acquire = async (id) => {
    const lease = await acquire(id);
    return {
      ...lease,
      release: () => {
        lease.release();
        markReleased();
      },
    };
  };
  let upstreamSignal: AbortSignal | undefined;
  const app = express();
  app.use(express.json());
  app.use(
    createTextAdmissionRouter({
      controller,
      workloadId: "text",
      apiKey: "fixture",
      fetchImpl: (async (_url, options) => {
        upstreamSignal = options?.signal ?? undefined;
        return new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode("data: hello\n\n"));
            },
          }),
        );
      }) as typeof fetch,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await once(server, "listening");
  const address = server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stream: true }),
  });
  assert.equal(controller.status()[0].acceptedOperations, 1);
  await response.body!.cancel();
  await released;
  assert.equal(upstreamSignal?.aborted, true);
  assert.equal(controller.status()[0].acceptedOperations, 0);
});
