import fs from "node:fs";
import path from "node:path";

/** A resolved native path for comparisons on Studio's Linux and macOS hosts. */
export const pathKey = (value) => path.resolve(String(value || ""));

/** Whether a native path is inside a folder, optionally including the folder itself. */
export function isInside(base, file, { orSame = false } = {}) {
  if (!base || !file) return false;
  const relative = path.relative(pathKey(base), pathKey(file));
  return relative
    ? relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    : orSame;
}

/** Free space where the models would land; the nearest existing parent answers for a folder not made yet. */
export function freeBytesAt(dir) {
  if (!dir) return null;
  let current = path.resolve(dir);
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const stats = fs.statfsSync(current);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
  return null;
}
