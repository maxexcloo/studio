import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
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

// `mise run dev` (dev.mjs) hands Vite and the server one token, so the
// server can tell a phone on the network from this computer even though every
// proxied request reaches it from 127.0.0.1 (see backend/client-trust.js).
const devProxyToken = process.env.STUDIO_DEV_PROXY_TOKEN || "";
const api: ProxyOptions = {
  target: `http://127.0.0.1:${process.env.STUDIO_DEV_API_PORT || 8787}`,
  configure(proxy) {
    if (!devProxyToken) return;
    proxy.on("proxyReq", (proxyReq, req) => {
      proxyReq.setHeader("x-studio-dev-client", req.socket.remoteAddress || "");
      proxyReq.setHeader("x-studio-dev-token", devProxyToken);
    });
  },
};

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: { outDir: "../dist", emptyOutDir: true },
  plugins: [react(), precompress()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": api,
      "/comfy": api,
    },
  },
});
