import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { closeRuntimeDatabase } from "../persistence/runtime.ts";

/**
 * A new folder under the system temporary folder, removed after the test that made it (or its
 * file, when made outside a test) once `close` has run and its runtime databases are closed.
 */
export function temporaryFolder(prefix, close) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  after(async () => {
    await close?.();
    closeRuntimeDatabase(folder);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}
