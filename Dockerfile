# syntax=docker/dockerfile:1
FROM node:26.12.1-trixie AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
ARG STUDIO_PREBUILT=0
RUN if [ "$STUDIO_PREBUILT" = 1 ]; then test -f dist/index.html; else npm run build; fi \
    && npm prune --no-audit --no-fund --omit=dev

FROM node:26.12.1-trixie-slim AS runtime

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
COPY --from=build /app/shared ./shared
COPY --from=build /app/workflows ./workflows

# Slim omits OpenSSL's default CA path; point apt at the trusted build image's bundle.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::https::CaInfo=/etc/ssl/certs/ca-certificates.crt --error-on=any update \
    && apt-get -o Acquire::https::CaInfo=/etc/ssl/certs/ca-certificates.crt --no-install-recommends --yes upgrade \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /opt/yarn* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir /data && chown node:node /data

USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
    CMD node -e 'fetch("http://127.0.0.1:" + process.env.PORT + "/api/ping").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["node", "server/index.js"]
