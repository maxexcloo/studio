# syntax=docker/dockerfile:1
FROM node:26.12.1-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --no-audit --no-fund --omit=dev

FROM node:26.12.1-bookworm-slim AS runtime

ENV STUDIO_DATA_DIR=/data \
    STUDIO_ENV_FILE=/data/.env \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=8787

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/server ./server
COPY --from=build /app/workflows ./workflows
# The Studio worker ComfyUI node, for ComfyUI images to copy from the matching Studio release.
COPY --from=build /app/comfyui/studio_worker/__init__.py /app/comfyui/studio_worker/files.py /app/comfyui/studio_worker/models.py /app/comfyui/studio_worker/README.md ./comfyui/studio_worker/

# Slim may omit a system CA bundle; retain TLS verification using Node's bundled roots.
RUN node -e 'const fs = require("node:fs"); const file = "/etc/ssl/certs/ca-certificates.crt"; if (!fs.existsSync(file)) { fs.mkdirSync("/etc/ssl/certs", { recursive: true }); fs.writeFileSync(file, require("node:tls").rootCertificates.join("\n")); }' \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get --error-on=any update \
    && apt-get --no-install-recommends --yes upgrade \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir /data && chown node:node /data

USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
    CMD node -e 'fetch("http://127.0.0.1:" + process.env.PORT + "/api/ping").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["node", "server/index.js"]
