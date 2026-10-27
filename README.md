# Studio

Studio is a media workspace for generating images and video, refining results and continuing an idea through saved visual sessions. It connects to ComfyUI and cloud providers, with account isolation, model imports and native MCP tools.

The rewrite uses React, Mantine and a persistent generation queue. Images and Videos share a bottom composer; Chat combines streamed conversation with generation inputs, results and saved iterations.

## Development

Use Node 26.12 or newer and the shared Mise tools:

```sh
mise run setup
mise run dev
```

Open <http://localhost:5173>. Vite provides HMR and the API watches its source on port 18787. Development data, media and local settings stay in `data/development`, separate from existing runtime data and the root `.env`. A new data folder starts with the sample profiles in `backend/samples/`. Automatic worker lifecycle control is disabled.

`mise run dev:demo` uses explicit sample generations without a GPU. Its SVG outputs are fixtures, not model inference.

Before submitting a change, run the checks, build the frontend and run the browser scenarios against that build. Install the browsers once with `npx playwright install chromium webkit`. Browser scenarios use isolated fixtures and cover desktop and phone interactions; real generation needs separate verification against the intended worker.

```sh
mise run check
mise run build
mise run test:browser
```

## Running Studio

The application image is `ghcr.io/maxexcloo/studio`; GPU runtimes use `ghcr.io/maxexcloo/studio-worker`. Every verified `main` commit publishes both under a `YYYY.M.D.N` version with a [GitHub release](https://github.com/maxexcloo/studio/releases). Deploy an exact version.

Mount a writable Studio data directory for media and editable definitions; it is the only source of live profiles, guides and catalogue data. Configure worker URLs and server-side credentials as described in [Configuration](CONFIGURATION.md). See [worker operations](worker/README.md) and [models and workflows](MODELS.md).

Run one application replica with `Recreate`; two schedulers must not control the same workers or SQLite database. Back up data while Studio is stopped, or use a SQLite-aware snapshot for the database alongside its media files; never copy a live SQLite database without its WAL state. Before an update that migrates data, rehearse the [migration and restore](CONFIGURATION.md#sqlite-migration--rollback) on a copy.

## Credits & Licence

Studio is a hard fork of [HEISS UI](https://github.com/tristmeister/HEISS-UI), based on [J-AI Studio](https://github.com/jasperdevs/J-AI-Studio). Their MIT copyright and licence notices remain in [LICENSE](LICENSE). The MantineHub theme is adapted under MIT from RubixCube Innovations. Native MCP modules retain their [AGPL-3.0 notice](backend/mcp.LICENSE).
