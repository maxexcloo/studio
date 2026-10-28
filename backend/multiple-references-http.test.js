import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { startFakeComfy } from "./fixtures/fake-comfy.js";

test(
  "ten declared references survive durable HTTP admission and reach every Comfy graph binding",
  { timeout: 30_000 },
  async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "studio-ten-references-"));
    const raw = JSON.parse(
      fs.readFileSync(
        new URL("./fixtures/profiles/flux3-klein-base-10-references.json", import.meta.url),
        "utf8",
      ),
    );
    fs.mkdirSync(path.join(directory, "workflows"));
    fs.writeFileSync(
      path.join(directory, "workflows", `${raw.studio.id}.json`),
      JSON.stringify(raw),
    );
    const info = JSON.parse(
      fs.readFileSync(
        new URL("./fixtures/object_info-comfyui-0.41.0-master-ce1e922.json", import.meta.url),
        "utf8",
      ),
    );
    for (const graph of [
      raw.graph,
      ...Object.values(raw.studio.imageModes || {})
        .map((mode) => mode.graph)
        .filter(Boolean),
    ]) {
      for (const node of Object.values(graph)) {
        info[node.class_type] ||= { input: { required: {} } };
        for (const [key, value] of Object.entries(node.inputs || {})) {
          if (typeof value === "string" && value) {
            info[node.class_type].input ||= { required: {} };
            info[node.class_type].input.required ||= {};
            info[node.class_type].input.required[key] = [[value]];
          }
        }
      }
    }
    const worker = await startFakeComfy({ objectInfo: info });
    const child = fork(fileURLToPath(new URL("./index.js", import.meta.url)), [], {
      env: {
        PATH: process.env.PATH,
        PORT: "0",
        HOST: "127.0.0.1",
        STUDIO_ENV_FILE: "/dev/null",
        STUDIO_DATA_DIR: directory,
        STUDIO_WORKERS: JSON.stringify([
          { id: "chosen", name: "Chosen", url: worker.url, capabilities: ["image"] },
        ]),
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    t.after(async () => {
      const stopped = child.exitCode === null ? once(child, "exit") : undefined;
      child.kill("SIGTERM");
      await stopped;
      await worker.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const [ready] = await Promise.race([
      once(child, "message"),
      once(child, "exit").then(() => {
        throw new Error("Reference fixture exited before readiness");
      }),
    ]);
    const base = ready.url.replace("localhost", "127.0.0.1");
    async function api(route, body) {
      const response = await fetch(base + route, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }
    const profile = (await api("/api/models")).body.profiles.find(
      (profile) => profile.id === `custom:${raw.studio.id}`,
    );
    assert.ok(profile, "the real ten-slot profile is offered by the worker catalogue");
    assert.equal(profile.mediaInputs.length, 10);
    const image = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const assetIds = [];
    for (let index = 0; index < 10; index++) {
      const form = new FormData();
      form.append("image", new Blob([image], { type: "image/png" }), `reference-${index}.png`);
      const response = await fetch(base + "/api/reference-assets/upload", {
        method: "POST",
        headers: { "X-Studio": "1" },
        body: form,
      });
      assert.equal(response.status, 201);
      assetIds.push((await response.json()).asset.id);
    }
    const references = profile.mediaInputs.map((slot, index) => ({
      slot: slot.id,
      assetId: assetIds[index],
    }));
    // Reusing an owned asset in another explicit role must remain a second binding.
    references[9].assetId = references[0].assetId;
    const input = {
      ...profile.defaults,
      profileId: profile.id,
      kind: "image",
      model: profile.model,
      workflow: profile.workflow,
      backendId: "chosen",
      prompt: "Combine these ten references",
      count: 1,
      referenceAssets: references,
    };
    const excess = await api("/api/generate", {
      ...input,
      referenceAssets: [...references, references[0]],
    });
    assert.equal(excess.status, 400);
    assert.match(excess.body.error, /accepts at most 1 image/);
    const unknown = await api("/api/generate", {
      ...input,
      referenceAssets: [...references, { slot: "not-declared", assetId: assetIds[0] }],
    });
    assert.equal(unknown.status, 400);
    assert.match(unknown.body.error, /does not accept reference slot/);
    const submitted = worker.nextPrompt();
    const accepted = await api("/api/generate", input);
    assert.equal(accepted.status, 200);
    const job = (await api("/api/queue")).body.jobs.find((job) => job.id === accepted.body.jobId);
    assert.deepEqual(job.input.referenceAssets, references);
    const actual = await submitted;
    assert.equal(worker.uploads.length, 10);
    for (const [index, slot] of profile.mediaInputs.entries())
      assert.equal(
        actual.prompt[slot.control.node].inputs[slot.control.input],
        `fixture-input-${index + 1}.png`,
      );
    assert.equal(worker.prompts.length, 1);
  },
);
