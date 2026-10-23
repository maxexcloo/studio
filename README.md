# Studio

Studio is a media workspace for generating images and video, refining results and continuing an idea through saved visual sessions. It connects to ComfyUI and cloud providers, with account isolation, model imports and native MCP tools.

The rewrite uses React, Mantine and a persistent generation queue. Images and Videos share a bottom composer; Chat combines streamed conversation with generation inputs, results and saved iterations. See [the working backlog](todo.md) for verification still required before replacing the live application.

## Development

Use Node 26.12 or newer and the shared Mise tools:

```sh
mise run setup
mise run dev
```

Open <http://localhost:5173>. Vite provides HMR and the API watches its source on port 18787. Development data, media and local settings stay in `data/development`, separate from existing runtime data and the root `.env`. When the sibling `ai` checkout exists, development reads its definitions and worker addresses. Automatic worker lifecycle control is disabled.

`npm run dev:demo` uses explicit sample generations without a GPU. Its SVG outputs are fixtures, not model inference. `npm run dev -- --lan` exposes the preview to the local network.

```sh
mise run check
mise run build
npm run test:browser
```

## Running Studio

The application image is `ghcr.io/maxexcloo/studio`; GPU runtimes use `ghcr.io/maxexcloo/studio-worker`. Deploy an exact verified version. The worker image has explicit `media` and `text` launch modes and preserves the existing shared GPU leases.

Mount a writable Studio data directory for media and editable definitions, and a read-only `ai` configuration directory for workload metadata and missing-definition seeds. Configure worker URLs and server-side credentials as described in [Configuration](CONFIGURATION.md). See [container operations](DOCKER.md), [worker operations](worker/README.md) and [models and workflows](MODELS.md).

Existing runtime state requires an offline [migration rehearsal and restore check](CONFIGURATION.md#sqlite-migration--rollback). Keep the current deployment until retained workflows and migration have been verified. Production remains single-replica with `Recreate` deployment behaviour.

## Credits & Licence

Studio is a hard fork of [HEISS UI](https://github.com/tristmeister/HEISS-UI), based on [J-AI Studio](https://github.com/jasperdevs/J-AI-Studio). Their MIT copyright and licence notices remain in [LICENSE](LICENSE). The MantineHub theme is adapted under MIT from RubixCube Innovations. Native MCP modules retain their [AGPL-3.0 notice](backend/mcp.LICENSE).
