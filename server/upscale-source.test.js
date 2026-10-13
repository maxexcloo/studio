import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { startFakeComfy } from "./fixtures/fake-comfy.js";

// Real native routes and staging, with PNG bytes behind a stand-in ComfyUI.
test("existing-image upscale probes zero gallery dimensions and the active source", { timeout: 30000 }, async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-upscale-source-"));
  const dataDir = path.join(temporary, "data");
  const modelDir = path.join(temporary, "models");
  fs.mkdirSync(dataDir); fs.mkdirSync(modelDir);
  process.env.HEISS_SEEDVR2_MODEL_DIR = modelDir;
  const { modelFiles, upscalePlan } = await import("./upscale.js");
  for (const name of ["seedvr2_ema_3b_fp8_e4m3fn.safetensors", "ema_vae_fp16.safetensors"]) {
    const fd = fs.openSync(path.join(modelDir, name), "w");
    fs.ftruncateSync(fd, modelFiles[name].bytes); fs.closeSync(fd);
  }
  const fixture = fs.readdirSync(path.join(here, "fixtures")).filter(name => name.startsWith("object_info-comfyui-")).sort().at(-1);
  const info = JSON.parse(fs.readFileSync(path.join(here, "fixtures", fixture), "utf8"));
  const combo = values => ["COMBO", { options: values }];
  info.SeedVR2LoadDiTModel = { input: { required: { model: combo(["seedvr2_ema_3b_fp8_e4m3fn.safetensors"]), device: combo(["cuda:0"]) }, optional: { offload_device: combo(["cpu"]) } } };
  info.SeedVR2LoadVAEModel = { input: { required: { model: combo(["ema_vae_fp16.safetensors"]), device: combo(["cuda:0"]) }, optional: { offload_device: combo(["cpu"]) } } };
  info.SeedVR2VideoUpscaler = { input: { required: {}, optional: { offload_device: combo(["cpu"]) } } };
  const fake = await startFakeComfy({ objectInfo: info });
  const images = new Map();
  for (const [name, width, height] of [["square.png", 640, 640], ["landscape.png", 960, 640], ["active.png", 1440, 960], ["active-original.png", 960, 640]]) {
    images.set(name, await sharp({ create: { width, height, channels: 3, background: "#345678" } }).png().toBuffer());
  }
  const items = [
    { id: "square", filename: "square.png", url: "/comfy/view?filename=square.png&type=output" },
    { id: "landscape", filename: "landscape.png", url: "/comfy/view?filename=landscape.png&type=output" },
    { id: "active", filename: "active-original.png", url: "/comfy/view?filename=active-original.png&type=output", upscaleActive: true, upscale: { status: "done", url: "/comfy/view?filename=active.png&type=output" } }
  ].map(item => ({ ...item, type: "image", status: "done", width: 0, height: 0, createdAt: new Date().toISOString(), model: "test-model", prompt: "" }));
  fs.writeFileSync(path.join(dataDir, "gallery.json"), JSON.stringify(items));
  const uploads = [];
  const viewRequests = [];
  const tunnels = new Set();
  const proxy = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/view") {
      viewRequests.push(url.searchParams.get("filename"));
      const buffer = images.get(url.searchParams.get("filename"));
      if (!buffer) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "image/png" }); res.end(buffer); return;
    }
    if (url.pathname === "/upload/image") {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      uploads.push(Buffer.concat(chunks));
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ name: "staged.png" })); return;
    }
    const upstream = http.request(fake.url + req.url, { method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  proxy.on("upgrade", (req, socket, head) => {
    const remote = new URL(fake.url);
    const upstream = net.connect(Number(remote.port), remote.hostname);
    tunnels.add(socket); tunnels.add(upstream);
    upstream.on("connect", () => {
      upstream.write(req.method + " " + req.url + " HTTP/1.1\r\n" + Object.entries(req.headers).map(([key,value]) => key + ": " + value).join("\r\n") + "\r\n\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy());
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const comfyUrl = "http://127.0.0.1:" + proxy.address().port;
  let server;
  try {
    server = fork(path.join(here, "index.js"), [], { cwd: path.join(here, ".."), env: { ...process.env, PORT: "0", HOST: "127.0.0.1", COMFY_URL: comfyUrl, HEISS_DATA_DIR: dataDir, HEISS_SEEDVR2_MODEL_DIR: modelDir, COMFY_OUTPUT_DIR: "", COMFY_INPUT_DIR: "", HEISS_NO_BROWSER: "1", HEISS_LAN: "0", npm_lifecycle_event: "" }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let errors = ""; server.stderr.on("data", chunk => { errors += chunk; });
    const message = await new Promise((resolve,reject) => { server.once("message", resolve); server.once("exit", code => reject(new Error("Server exited " + code + ": " + errors))); });
    const base = message.url.replace("localhost", "127.0.0.1");
    for (const [id,width,height] of [["square",640,640],["landscape",960,640],["active",960,640]]) {
      const response = await fetch(base + "/api/upscale", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ galleryItemId: id, quality: "fast" }) });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.deepEqual(result.plan, upscalePlan({ width, height, quality: "fast" }));
      assert.equal(result.plan.sourceWidth, width); assert.equal(result.plan.sourceHeight, height);
      assert.ok(result.plan.resolution > 16);
    }
    assert.equal(uploads.length, 3);
    assert.ok(viewRequests.includes("active.png"), "Native reference staging keeps using the active upscale, at the original framing dimensions.");
    // Planning probes bytes without changing the original gallery dimensions.
    const galleryResponse = await fetch(base + "/api/gallery");
    const gallery = await galleryResponse.json();
    const original = Array.isArray(gallery) ? gallery : gallery.items || gallery.outputs || [];
    const originals = original.filter(item => items.some(source => source.id === item.id));
    assert.equal(originals.length, 3);
    for (const item of originals) {
      assert.equal(item.width, 0); assert.equal(item.height, 0);
    }
  } finally {
    if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once("exit", resolve)); server.kill("SIGTERM"); await exited; }
    for (const socket of tunnels) socket.destroy();
    proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); await fake.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
