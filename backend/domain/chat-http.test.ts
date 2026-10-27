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
import type { GenerationInput, QueueJob } from "../../shared/queue.ts";

test(
  "Chat streams into an owned media session and reopens after restart",
  { timeout: 30_000 },
  async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "studio-chat-http-"));
    const requests: any[] = [];
    const gateway = createServer(async (request, response) => {
      if (request.method === "GET" && request.url === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [
              { id: "fixture-text-model", owned_by: "Fixture Gateway" },
              { id: "alternate-text", name: "Alternate Text", provider: "Fixture Provider" },
              { id: "restricted-text", owned_by: "Fixture Provider" },
              { id: "not-alternate-text", owned_by: "Fixture Provider" },
            ],
          }),
        );
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      requests.push(input);
      response.writeHead(200, { "content-type": "text/event-stream" });
      const latest = input.messages.at(-1).content;
      const content = (typeof latest === "string" ? latest : latest[0].text).split(
        "\n\nStudio context",
      )[0];
      response.write(
        `data: ${JSON.stringify({ model: "actual-" + input.model, choices: [{ delta: { content: "Here is my response." } }] })}\n\n`,
      );
      const operation =
        content === "Create a landscape."
          ? "image"
          : content === "Make it painterly." || content === "Submit edited card."
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
    let allowedModels = "alternate-*,fixture-text-model,restricted-text,unadvertised-model";
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
          STUDIO_CHAT_GATEWAY_URL: gatewayUrl,
          STUDIO_CHAT_GATEWAY_KEY: "fixture",
          STUDIO_CHAT_GATEWAY_MODELS: allowedModels,
          STUDIO_PROMPT_WRITER_URL: "http://127.0.0.1:1",
          STUDIO_PROMPT_WRITER_KEY: "unrelated-fixture",
          STUDIO_PROMPT_WRITER_MODEL: "unrelated-writer-model",
          STUDIO_ASSISTANT_SPICY_MODEL: "restricted-text",
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
      extra?: object,
    ) {
      const response = await request(`/api/sessions/${sessionId}/chat`, "POST", {
        content,
        generation,
        references,
        ...extra,
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
        nsfwModels: false,
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
      const chatStatus = await api("/api/chat/status");
      assert.equal(chatStatus.available, true);
      assert.equal(chatStatus.defaultModelId, "alternate-text");
      assert.deepEqual(
        chatStatus.models.map((model: any) => model.id),
        ["alternate-text", "fixture-text-model"],
      );
      assert.equal(chatStatus.models[0].provider, "Fixture Provider");
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
      // Animate picks its own video model, and says why when this account has none to use.
      const invalid = await chat(session.id, "Animate this.", { operation: "image", input });
      const explanation = invalid.filter((event) => event.event === "message").at(-1)!.data;
      assert.match(explanation.actionError, /No video profile that takes a starting image/);
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
      const style = { assetId: asset.id, source: "upload", slot: "style" };
      const continued = await chat(session.id, "Make it painterly.", {
        operation: "refine",
        parentJobId: second.id,
        input: {
          ...second.input,
          referenceAssets: [...(second.input.referenceAssets as object[]), style],
        },
      });
      const thirdId = continued.find((event) => event.event === "generation")!.data.job.id;
      const third = await completed(thirdId);
      assert.equal(third.parentJobId, second.id);
      const thirdReferences = third.input.referenceAssets as { assetId: string }[];
      assert.equal(
        Buffer.from(thirdReferences[0].assetId.slice(8), "base64url").toString(),
        second.outputs[0].url,
        "third turn anchors the new parent rather than its inherited old source",
      );
      assert.deepEqual(thirdReferences[1], style, "a deliberate additional reference is retained");
      const revisionInput: GenerationInput = {
        ...third.input,
        prompt: "Exact edited card prompt",
        steps: 3,
        seed: 123,
      };
      const revised = await chat(session.id, "Submit edited card.", undefined, undefined, {
        modelId: "fixture-text-model",
        revision: { sourceJobId: third.id, operation: "refine", input: revisionInput },
      });
      assert.equal(revised.filter((event) => event.event === "generation").length, 1);
      const fourthId = revised.find((event) => event.event === "generation")!.data.job.id;
      const fourth = await completed(fourthId);
      assert.equal(
        fourth.input.prompt,
        revisionInput.prompt,
        "tool prompt cannot replace explicit card edit",
      );
      assert.equal(fourth.input.seed, 123);
      assert.equal(fourth.input.steps, 3);
      assert.deepEqual(fourth.input.referenceAssets, revisionInput.referenceAssets);
      assert.equal(fourth.parentJobId, third.id);
      assert.equal(requests.at(-1).model, "fixture-text-model");
      const revisionContext = requests.at(-1).messages.at(-1).content;
      assert.match(revisionContext, /Exact edited card prompt/);
      assert.match(revisionContext, /"steps":\{"before":2,"after":3\}/);
      const savedRevision = (await api(`/api/sessions/${session.id}/chat`)).messages;
      const editedReply = savedRevision.find((message: any) => message.jobId === fourthId);
      assert.equal(editedReply.actualModelId, "actual-fixture-text-model");
      assert.equal(editedReply.provider, "Fixture Gateway");
      const aliasJobIds: string[] = [];
      for (const alias of ["startImage", "startImageId"]) {
        const legacyInput = {
          ...input,
          prompt: "Keep the explicitly selected source",
          [alias]: asset.id,
        };
        const legacyEvents = await chat(session.id, "Submit edited card.", undefined, undefined, {
          revision: { sourceJobId: fourth.id, operation: "refine", input: legacyInput },
        });
        const legacyId = legacyEvents.find((event) => event.event === "generation")!.data.job.id;
        aliasJobIds.push(legacyId);
        const legacyJob = await completed(legacyId);
        assert.equal(legacyJob.input[alias], asset.id);
        assert.equal(
          (legacyJob.input.referenceAssets as { assetId: string }[])[0]?.assetId,
          asset.id,
          "legacy alias preserves its own chosen primary rather than replacing it with the parent result",
        );
      }
      const messageCount = (await api(`/api/sessions/${session.id}/chat`)).messages.length,
        gatewayCount = requests.length;
      for (const payload of [
        { content: "Not allowed", modelId: "restricted-text" },
        { content: "Unknown", modelId: "not-in-gateway" },
        { content: "Not advertised", modelId: "unadvertised-model" },
        { content: "Outside allowlist", modelId: "not-alternate-text" },
        {
          content: "Foreign revision",
          revision: { sourceJobId: "missing", operation: "image", input },
        },
        {
          content: "Wrong media model",
          revision: { sourceJobId: third.id, operation: "animate", input },
        },
        {
          content: "Foreign start image",
          revision: {
            sourceJobId: third.id,
            operation: "refine",
            input: { ...input, startImageId: "not-owned" },
          },
        },
      ]) {
        const denied = await request(`/api/sessions/${session.id}/chat`, "POST", payload);
        assert.equal(
          denied.status,
          payload.revision ? (payload.revision.sourceJobId === "missing" ? 404 : 400) : 403,
        );
      }
      assert.equal(requests.length, gatewayCount);
      assert.equal((await api(`/api/sessions/${session.id}/chat`)).messages.length, messageCount);
      await chat(session.id, "Discuss this image.", { operation: "image", input }, [asset.id]);
      assert.match(
        JSON.stringify(requests.at(-1).messages.slice(1, -1)),
        /Exact edited card prompt/,
      );
      assert.match(JSON.stringify(requests.at(-1).messages.slice(1, -1)), new RegExp(fourthId));
      assert.match(
        requests.at(-1).messages.at(-1).content[1].image_url.url,
        /^data:image\/jpeg;base64,/,
      );
      assert.equal(requests.at(-1).model, "alternate-text");
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
          [thirdId, "completed"],
          [fourthId, "completed"],
          ...aliasJobIds.map((id) => [id, "completed"]),
        ],
      );
      await stop();
      allowedModels = "";
      await start();
      const unconfigured = await api("/api/chat/status");
      assert.equal(unconfigured.available, false);
      assert.deepEqual(unconfigured.models, []);
      assert.match(unconfigured.reason, /STUDIO_CHAT_GATEWAY_MODELS/);
      const beforeDisabled = requests.length;
      assert.equal(
        (
          await request(`/api/sessions/${session.id}/chat`, "POST", {
            content: "No allowed models",
          })
        ).status,
        503,
      );
      assert.equal(requests.length, beforeDisabled);
      assert.deepEqual((await api(`/api/sessions/${session.id}/chat`)).messages, messages);
    } finally {
      await stop();
      gateway.closeAllConnections();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
