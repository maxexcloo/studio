import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { type Plugin, type ProxyOptions, defineConfig } from "vite";

import { precompressDir } from "./precompress.mjs";

// Brotli and gzip copies of the built files, which the server sends to browsers that take them.
function precompress(): Plugin {
  let outDir = "dist";
  return {
    name: "studio-precompress",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      precompressDir(outDir);
    },
  };
}

const api: ProxyOptions = {
  target: `http://127.0.0.1:${process.env.STUDIO_DEV_API_PORT}`,
};

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: { outDir: "../dist", emptyOutDir: true },
  plugins: [react(), precompress()],
  server: {
    host: "127.0.0.1",
    // dev.mjs picks a free port.
    port: Number(process.env.STUDIO_DEV_PORT),
    strictPort: true,
    proxy: {
      "/api": api,
      "/comfy": api,
    },
  },
});
