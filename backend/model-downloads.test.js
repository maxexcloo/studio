import assert from "node:assert/strict";
import test from "node:test";

const { downloadState, isNetworkError, resumeValidator, setDownloadTransport, startDownload } =
  await import("./model-downloads.js");

const spec = (file) => ({
  id: `vae:test:${file}`,
  file,
  folder: "vae",
  label: "Test VAE",
  url: "https://huggingface.co/x/resolve/main/a.safetensors",
  bytes: 10,
});

async function settle(file) {
  for (let i = 0; i < 200; i += 1) {
    const done = downloadState().recent.find((item) => item.file === file);
    if (done) return done;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("download never finished");
}

test("network drops are told apart from answers", () => {
  assert.equal(isNetworkError(new TypeError("terminated")), true);
  assert.equal(isNetworkError(Object.assign(new Error("read"), { code: "ECONNRESET" })), true);
  assert.equal(isNetworkError(new Error("Hugging Face answered 500 for a.safetensors.")), false);
});

test("a dropped connection is retried by itself and finishes", async () => {
  let tries = 0;
  setDownloadTransport(async () => {
    tries += 1;
    if (tries === 1) throw new TypeError("terminated");
  });
  startDownload(spec("drop.safetensors"));
  const done = await settle("drop.safetensors");
  assert.equal(done.status, "done");
  assert.equal(tries, 2);
});

test("a gated file stops at once and points to the browser", async () => {
  setDownloadTransport(async (entry, _signal, { finalError }) => {
    throw finalError(`${entry.file} needs a Hugging Face login`, { browser: true });
  });
  startDownload(spec("gated.safetensors"));
  const failed = await settle("gated.safetensors");
  assert.deepEqual([failed.status, failed.retryable, failed.needsBrowser], ["error", false, true]);
  setDownloadTransport(null);
});

test("If-Range uses a strong ETag, else the date, and nothing for notes from before", () => {
  assert.equal(
    resumeValidator({ etag: '"abc"', lastModified: "Mon, 01 Jan 2024 00:00:00 GMT" }),
    '"abc"',
  );
  assert.equal(
    resumeValidator({ etag: 'W/"abc"', lastModified: "Mon, 01 Jan 2024 00:00:00 GMT" }),
    "Mon, 01 Jan 2024 00:00:00 GMT",
  );
  assert.equal(resumeValidator({}), "");
});
