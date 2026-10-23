import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { QueueJob } from "../../shared/queue.ts";

test(
  "Chat streams into an owned media session and reopens after restart",
  { timeout: 30_000 },
  async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "studio-chat-http-"));
    const requests: any[] = [];
    const gateway = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      requests.push(input);
      response.writeHead(200, { "content-type": "text/event-stream" });
      const latest = input.messages.at(-1).content;
      const content = typeof latest === "string" ? latest : latest[0].text;
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Here is my response." } }] })}\n\n`,
      );
      const operation =
        content === "Create a landscape."
          ? "image"
          : content === "Make it painterly."
            ? "refine"
            : content === "Animate this."
              ? "animate"
              : undefined;
      if (operation)
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "request_media", arguments: JSON.stringify({ operation, prompt: operation === "image" ? "Neutral mountain landscape" : "Painterly mountain landscape" }) } }] } }] })}\n\n`,
        );
      response.end("data: [DONE]\n\n");
    });
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");
    const gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
    let server: ChildProcess | undefined;
    let base = "";
    let cookie = "";
    async function start() {
      server = fork(fileURLToPath(new URL("../index.js", import.meta.url)), [], {
        env: {
          ...process.env,
          PORT: "0",
          HOST: "127.0.0.1",
          STUDIO_ENV_FILE: "/dev/null",
          STUDIO_DATA_DIR: dataDir,
          STUDIO_WORKERS: "[]",
          STUDIO_DEMO: "1",
          STUDIO_MULTI_USER: "1",
          STUDIO_CONFIG_DIR: "",
          STUDIO_RUNTIME_AUTOMATIC: "",
          STUDIO_TEXT_ADMISSION_TOKEN: "",
          STUDIO_CLIPROXYAPI_URL: "",
          CLIPROXYAPI_URL: "",
          STUDIO_PROMPT_WRITER_URL: gatewayUrl,
          STUDIO_PROMPT_WRITER_KEY: "fixture",
          STUDIO_PROMPT_WRITER_MODEL: "fixture-text-model",
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      let errors = "";
      server.stderr!.on("data", (chunk) => {
        errors += String(chunk);
      });
      const ready = await Promise.race([
        once(server, "message").then(([message]) => message as { url: string }),
        once(server, "exit").then(([code]) => {
          throw new Error(`Fixture exited ${code}: ${errors}`);
        }),
      ]);
      base = ready.url.replace("localhost", "127.0.0.1");
    }
    async function stop() {
      if (!server || server.exitCode !== null) return;
      const stopped = once(server, "exit");
      server.kill("SIGTERM");
      await stopped;
    }
    async function request(route: string, method = "GET", input?: unknown) {
      return fetch(base + route, {
        method,
        headers: { "content-type": "application/json", cookie },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
    }
    async function api(route: string, method = "GET", input?: unknown): Promise<any> {
      const response = await request(route, method, input);
      assert.equal(response.ok, true, `${route} returned ${response.status}`);
      const nextCookie = response.headers
        .getSetCookie()
        .find((value) => value.startsWith("studio_account="));
      if (nextCookie) cookie = nextCookie.split(";")[0];
      return response.json();
    }
    async function chat(
      sessionId: string,
      content: string,
      generation: unknown,
      references?: string[],
    ) {
      const response = await request(`/api/sessions/${sessionId}/chat`, "POST", {
        content,
        generation,
        references,
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
      return (await response.text())
        .split("\n\n")
        .filter(Boolean)
        .map((frame) => ({
          event: frame.split("\n")[0].slice(7),
          data: JSON.parse(frame.split("\ndata: ")[1]),
        }));
    }
    async function completed(id: string): Promise<QueueJob> {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const job = (await api("/api/queue")).jobs.find((entry: QueueJob) => entry.id === id);
        if (["completed", "failed", "cancelled"].includes(job?.status)) {
          assert.equal(job.status, "completed", job.reason);
          return job;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Chat generation did not finish.");
    }
    try {
      await start();
      await api("/api/accounts/bootstrap", "POST", {
        username: "administrator",
        password: "fixture administrator password",
      });
      const adminCookie = cookie;
      const features = {
        imageGeneration: true,
        imageReferences: true,
        gallery: true,
        promptAssistant: true,
        cloudModels: false,
      };
      await api("/api/accounts/profiles", "POST", {
        id: "artists",
        name: "Artists",
        allModels: true,
        features,
      });
      await api("/api/accounts/users", "POST", {
        username: "artist",
        password: "fixture artist password",
        accessProfileId: "artists",
      });
      await api("/api/accounts/profiles", "POST", {
        id: "denied",
        name: "No Assistant",
        allModels: true,
        features: { ...features, promptAssistant: false },
      });
      await api("/api/accounts/users", "POST", {
        username: "denied",
        password: "fixture denied password",
        accessProfileId: "denied",
      });
      cookie = "";
      const account = await api("/api/accounts/sign-in", "POST", {
        username: "artist",
        password: "fixture artist password",
      });
      assert.equal(account.account.role, "user");
      const artistCookie = cookie;
      assert.equal((await api("/api/chat/status")).available, true);
      const { session } = await api("/api/sessions", "POST", { title: "Chat Landscape" });
      const input = {
        profileId: "mock-flux-schnell",
        model: "flux1-schnell.safetensors",
        steps: 2,
        width: 256,
        height: 256,
        seed: 42,
        backendId: "",
        allowFallback: true,
      };
      await chat(session.id, "Explain depth of field.", { operation: "image", input });
      assert.equal((await api("/api/queue")).jobs.length, 0, "discussion does not submit media");
      const generated = await chat(session.id, "Create a landscape.", {
        operation: "image",
        input,
      });
      const firstId = generated.find((event) => event.event === "generation")!.data.job.id;
      const first = await completed(firstId);
      assert.equal(first.sessionId, session.id);
      assert.equal(first.input.allowFallback, true);
      assert.equal(first.input.seed, 42);
      assert.equal((await api("/api/sessions")).sessions.length, 1);
      const refined = await chat(session.id, "Make it painterly.", { operation: "image", input });
      const secondId = refined.find((event) => event.event === "generation")!.data.job.id;
      const second = await completed(secondId);
      assert.equal(second.operation, "refine");
      assert.equal(second.parentJobId, first.id);
      assert.equal(second.sessionId, first.sessionId);
      assert.equal(
        (second.input.referenceAssets as unknown[]).length,
        1,
        "follow-up anchors the latest own output",
      );
      const invalid = await chat(session.id, "Animate this.", { operation: "image", input });
      const explanation = invalid.filter((event) => event.event === "message").at(-1)!.data;
      assert.match(explanation.actionError, /Choose a video model/);
      assert.equal((await api("/api/queue")).jobs.length, 2);
      const png = await sharp({
        create: { width: 32, height: 16, channels: 3, background: "white" },
      })
        .png()
        .toBuffer();
      const form = new FormData();
      form.append("image", new Blob([png], { type: "image/png" }), "reference.png");
      const upload = await fetch(base + "/api/reference-assets/upload", {
        method: "POST",
        headers: { cookie, "X-Studio": "1" },
        body: form,
      });
      assert.equal(upload.status, 201);
      const asset = (await upload.json()).asset;
      await chat(session.id, "Discuss this image.", { operation: "image", input }, [asset.id]);
      assert.match(
        requests.at(-1).messages.at(-1).content[1].image_url.url,
        /^data:image\/jpeg;base64,/,
      );
      assert.equal(requests.at(-1).model, "fixture-text-model");
      cookie = adminCookie;
      assert.equal((await request(`/api/sessions/${session.id}/chat`)).status, 404);
      assert.equal(
        (await request(`/api/sessions/${session.id}/chat`, "POST", { content: "Foreign session" }))
          .status,
        404,
      );
      cookie = "";
      await api("/api/accounts/sign-in", "POST", {
        username: "denied",
        password: "fixture denied password",
      });
      const deniedSession = (await api("/api/sessions", "POST", { title: "No Chat" })).session;
      assert.equal((await api("/api/chat/status")).available, false);
      const before = requests.length;
      assert.equal(
        (
          await request(`/api/sessions/${deniedSession.id}/chat`, "POST", {
            content: "No permission",
          })
        ).status,
        403,
      );
      assert.equal(requests.length, before);
      cookie = artistCookie;
      const messages = (await api(`/api/sessions/${session.id}/chat`)).messages;
      assert.equal(messages.find((message: any) => message.jobId === firstId).id, firstId);
      await stop();
      await start();
      assert.deepEqual((await api(`/api/sessions/${session.id}/chat`)).messages, messages);
      const reopened = await api(`/api/sessions/${session.id}`);
      assert.deepEqual(
        reopened.jobs.map((job: QueueJob) => [job.id, job.status]),
        [
          [firstId, "completed"],
          [secondId, "completed"],
        ],
      );
    } finally {
      await stop();
      gateway.closeAllConnections();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
