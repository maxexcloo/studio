import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readJsonFile, writeBytesFile, writeBytesFileAsync, writeJsonFile } from "./json-store.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-json-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("writes land whole", () => {
  const file = path.join(dir, "state.json");
  writeJsonFile(file, { version: 1 });
  writeJsonFile(file, { version: 2 });
  assert.deepEqual(readJsonFile(file), { version: 2 });
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.includes(".tmp-")),
    [],
  );
});

test("byte writes preserve a good destination while a replacement is validated", async () => {
  const file = path.join(dir, "image.bin");
  const first = Buffer.from([0, 255, 1, 254]);
  const replacement = Buffer.from([8, 0, 9]);
  writeBytesFile(file, first, { mode: 0o600 });
  await assert.rejects(
    writeBytesFileAsync(file, replacement, {
      validate: async (temporary) => {
        assert.deepEqual(fs.readFileSync(temporary), replacement);
        assert.deepEqual(fs.readFileSync(file), first);
        throw new Error("Media could not be read");
      },
    }),
    /Media could not be read/,
  );
  assert.deepEqual(fs.readFileSync(file), first);
  await writeBytesFileAsync(file, replacement, { mode: 0o600 });
  assert.deepEqual(fs.readFileSync(file), replacement);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("a corrupt file is set aside, not lost", () => {
  const file = path.join(dir, "torn.json");
  fs.writeFileSync(file, '{"stacks": ["a", "b"');
  assert.throws(() => readJsonFile(file), SyntaxError);
  assert.equal(
    fs.readdirSync(dir).some((name) => name.startsWith("torn.json.corrupt-")),
    true,
  );
});

test("missing still throws, so callers use their defaults", () => {
  assert.throws(() => readJsonFile(path.join(dir, "never.json")), { code: "ENOENT" });
});
