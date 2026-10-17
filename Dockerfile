# syntax=docker/dockerfile:1

# ---- Stage 1: build the frontend -------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Build tools (vite, typescript, @tailwindcss/vite, ...) live in devDependencies.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# The files the build reads. vite.config.ts imports scripts/precompress.mjs,
# and the build generates brotli+gzip copies of dist/ through it.
COPY index.html vite.config.ts tsconfig.json components.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# tsc -b && vite build → dist/ (public/ is copied in by Vite).
RUN npm run build

# ---- Stage 2: runtime-only node_modules --------------------------------------
# Installs express, busboy and sharp on this exact base, so sharp gets the
# musl prebuild; ffmpeg-static (optional) downloads its binary here.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- Stage 3: runtime --------------------------------------------------------
FROM node:22-alpine
WORKDIR /app

# In a container the server must listen beyond 127.0.0.1 to be reachable through
# the published port. HEISS_NO_BROWSER=1 keeps it from opening a nonexistent
# browser. Data and the settings the app saves (.env) live on the /data volume,
# not in the image, so Settings survive a new container. ComfyUI is looked for
# on the machine Docker runs on until Settings › Connection saves another address.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    HEISS_NO_BROWSER=1 \
    HEISS_DATA_DIR=/data \
    HEISS_ENV_FILE=/data/.env \
    HEISS_DEFAULT_COMFY_URL=http://host.docker.internal:8188

COPY --chown=node:node --from=deps  /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node workflows ./workflows
COPY --chown=node:node package.json ./

# The data dir holds gallery, vault, downloads and the saved settings: writable.
# (--chown above instead of chown -R, which would copy node_modules into a layer again.)
RUN mkdir -p /data && chown node:node /app /data
USER node

EXPOSE 8787
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 || exit 1

# start.mjs keeps the app in the foreground and honors the app's restart
# requests without killing the container. Its own dependency checks are no-ops
# here: the image already ships everything it looks for.
CMD ["node", "scripts/start.mjs"]
