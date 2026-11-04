// Brotli and gzip copies of the built app's text files, made once at build
// time (frontend/vite.config.ts runs this after every build). The server sends them to
// browsers that accept them, which matters most for a phone on Wi-Fi: the
// app's scripts and styles shrink to roughly a quarter.
import fs from "node:fs";
import path from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const compressible = /\.(?:js|mjs|css|html|svg|json|webmanifest|txt|map|wasm)$/i;
// Below this, the saving does not pay for the extra file and header.
const minBytes = 1024;

/** Writes `<file>.br` and `<file>.gz` next to each compressible file in `dir`. Returns how many files got them. */
export function precompressDir(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (!entry.isFile() || !compressible.test(file)) continue;
    const source = fs.readFileSync(file);
    if (source.length < minBytes) continue;
    const variants = [
      [
        ".br",
        brotliCompressSync(source, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: 11,
            [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
          },
        }),
      ],
      [".gz", gzipSync(source, { level: 9 })],
    ];
    let wrote = false;
    for (const [suffix, compressed] of variants) {
      // A copy that is not smaller is left out; the server then sends the file itself.
      if (compressed.length >= source.length) continue;
      fs.writeFileSync(`${file}${suffix}`, compressed);
      wrote = true;
    }
    if (wrote) count += 1;
  }
  return count;
}
