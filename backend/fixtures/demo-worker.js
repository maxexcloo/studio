/**
 * A worker without a GPU: fake ComfyUI with the recorded node list and the test workflows, which
 * finishes every run shortly after it is queued with a plain picture, or holds it with `hold`. For
 * tests that need finished runs and for `mise run dev:demo`.
 */
import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { startFakeComfy } from "./fake-comfy.js";
import { testImageProfile, testVideoProfile, writeTestWorkflows } from "./test-workflows.js";

const here = import.meta.dirname;
const snapshot = fs
  .readdirSync(here)
  .filter((name) => name.startsWith("object_info-comfyui-"))
  .sort()
  .at(-1);

export async function startDemoWorker(dataDir, { hold = false } = {}) {
  writeTestWorkflows(dataDir);
  const objectInfo = JSON.parse(fs.readFileSync(path.join(here, snapshot), "utf8"));
  objectInfo.CheckpointLoaderSimple.input.required.ckpt_name[0] = [
    testImageProfile.studio.defaults.model,
    testVideoProfile.studio.defaults.model,
  ];
  const outputFiles = new Map();
  const worker = await startFakeComfy({
    objectInfo,
    outputFiles,
    acknowledgePrompt(prompt) {
      if (hold) return true;
      setTimeout(async () => {
        const nodes = Object.entries(prompt.prompt || {});
        const [save, node] =
          nodes.find(([, item]) => ["SaveImage", "SaveVideo"].includes(item.class_type)) || [];
        const latent = nodes.find(([, item]) => item.inputs?.width && item.inputs?.height)?.[1];
        const filename = `demo-${prompt.id}.png`;
        outputFiles.set(
          filename,
          await sharp({
            create: {
              width: Number(latent?.inputs.width) || 512,
              height: Number(latent?.inputs.height) || 512,
              channels: 3,
              background: "#4c5b8a",
            },
          })
            .png()
            .toBuffer(),
        );
        const media = node?.class_type === "SaveVideo" ? "videos" : "images";
        worker.finish(prompt.id, {
          outputs: save
            ? { [save]: { [media]: [{ filename, subfolder: "", type: "output" }] } }
            : {},
        });
      }, 300);
      return true;
    },
  });
  return worker;
}
