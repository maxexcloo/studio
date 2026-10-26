import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// env.js runs once per process, so the case starts a fresh one.
test("the shell beats Studio's settings file, and saving rewrites only the file's own lines", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-env-"));
  const file = path.join(dir, "settings.env");
  try {
    fs.writeFileSync(file, "STUDIO_DEMO=1\nSTUDIO_ALLOWED_HOSTS=from-file\nSTUDIO_TRASH_DAYS=9\n");
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        const env = await import("./backend/env.js");
        const before = { hosts: process.env.STUDIO_ALLOWED_HOSTS, hostsFromFile: env.envFileKeys.has("STUDIO_ALLOWED_HOSTS"), demoFromFile: env.envFileKeys.has("STUDIO_DEMO") };
        env.writeLocalEnvValue("STUDIO_DEMO", "0");
        env.removeLocalEnvValue("STUDIO_TRASH_DAYS");
        console.log(JSON.stringify({ before, demo: process.env.STUDIO_DEMO, trash: process.env.STUDIO_TRASH_DAYS ?? null, file: (await import("node:fs")).readFileSync(${JSON.stringify(file)}, "utf8") }));
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
    const result = JSON.parse(output);
    assert.deepEqual(result.before, {
      hosts: "from-shell",
      hostsFromFile: false,
      demoFromFile: true,
    });
    assert.equal(result.demo, "0");
    assert.equal(result.trash, null);
    assert.equal(result.file, "STUDIO_DEMO=0\nSTUDIO_ALLOWED_HOSTS=from-file\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
