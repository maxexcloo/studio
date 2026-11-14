import fs from "node:fs";
import path from "node:path";

/**
 * Atomic byte writes and JSON recovery for Studio files.
 *
 * A plain writeFileSync truncates the file first, so a crash, a full disk or a
 * killed process mid-write leaves half a file. Every loader here treats an
 * unreadable file as "nothing saved yet", and the next save then replaces the
 * user's stacks, preferences or password config with an empty one.
 *
 * Writes go to a temporary file that is flushed and then renamed over the
 * old one (atomic on the same disk), so a reader sees the old file or the new
 * one, never half of either. A file corrupted some other way is set aside as
 * `.corrupt-<time>` instead of being overwritten, so nothing is lost silently.
 */

/** The saved value. Throws when there is none (missing or corrupt), so callers fall back to defaults. */
export function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw error;
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      // Leave it in place; the next write replaces it either way.
    }
    console.warn(`[Studio] ${path.basename(file)} was unreadable; it was set aside.`);
    throw error;
  }
}

// Each write gets its own temporary name, so a write started while another is
// still running (an async gallery save, then the exit flush) never shares one.
let temporaryCount = 0;
const temporaryFor = (file) => `${file}.tmp-${process.pid}-${(temporaryCount += 1)}`;

export function writeJsonFile(file, value, { mode } = {}) {
  writeBytesFile(file, JSON.stringify(value, null, 2), { mode });
}

/** Same-directory writes become visible only after the bytes and directory entry are durable. */
export function writeBytesFile(file, bytes, { mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = temporaryFor(file);
  try {
    const handle = fs.openSync(temporary, "wx", mode);
    try {
      fs.writeFileSync(handle, bytes);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), "r");
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** Validate completed media before replacement; reproducible caches can skip durability syncs. */
export async function writeBytesFileAsync(file, bytes, { mode, validate, durable = true } = {}) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = temporaryFor(file);
  try {
    const handle = await fs.promises.open(temporary, "wx", mode);
    try {
      await handle.writeFile(bytes);
      if (durable) await handle.sync();
    } finally {
      await handle.close();
    }
    if (validate) await validate(temporary);
    await fs.promises.rename(temporary, file);
    if (durable) {
      const directory = await fs.promises.open(path.dirname(file), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
}

export const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));
