import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// env.js runs once per process, so the case starts a fresh one.
test("the shell beats Studio's settings file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-env-"));
  const file = path.join(dir, "settings.env");
  try {
    fs.writeFileSync(file, "STUDIO_DEMO=1\nSTUDIO_ALLOWED_HOSTS=from-file\n");
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        const env = await import("./backend/env.js");
        console.log(JSON.stringify({ hosts: process.env.STUDIO_ALLOWED_HOSTS, demo: process.env.STUDIO_DEMO, hostsFromFile: env.envFileKeys.has("STUDIO_ALLOWED_HOSTS"), demoFromFile: env.envFileKeys.has("STUDIO_DEMO") }));
      `,
      ],
      {
        cwd: path.join(here, ".."),
        env: {
          PATH: process.env.PATH,
          NODE_TEST_CONTEXT: "",
          STUDIO_ENV_FILE: file,
          STUDIO_ALLOWED_HOSTS: "from-shell",
        },
        encoding: "utf8",
      },
    );
    assert.deepEqual(JSON.parse(output), {
      hosts: "from-shell",
      demo: "1",
      hostsFromFile: false,
      demoFromFile: true,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
