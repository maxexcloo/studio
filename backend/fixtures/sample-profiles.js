// Imported first by tests that run the sample profiles: a fresh data folder holding them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { samplesDirectory } from "../profile-seed.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-samples-"));
process.env.STUDIO_DATA_DIR = dataDir;
fs.cpSync(samplesDirectory, path.join(dataDir, "workflows"), {
  recursive: true,
  filter: (source) => !source.endsWith(".md"),
});
process.on("exit", () => fs.rmSync(dataDir, { recursive: true, force: true }));
