import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createModelFiles } from "./onnx.ts";

test("model files download into their folders, nested ones included", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-onnx-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dataDir, "models", "old"), { recursive: true });
  const model = createModelFiles({
    dataDir,
    folder: "models",
    revision: "new",
    // SigLIP 2's encoders sit in an `onnx/` folder of their repository.
    files: {
      "tokenizer.json": "https://example.test/a",
      "onnx/model.onnx": "https://example.test/b",
    },
    label: "test model",
    fetch: async (url) => new Response(url),
    log: { info: () => {} },
  });
  assert.equal(model.downloaded(), false);
  await model.ensureDownloaded();
  assert.equal(model.downloaded(), true);
  assert.equal(fs.readFileSync(model.file("onnx/model.onnx"), "utf8"), "https://example.test/b");
  assert.deepEqual(fs.readdirSync(path.join(dataDir, "models")), ["new"], "older revisions go");
  assert.equal(model.unavailable(), "");
});
