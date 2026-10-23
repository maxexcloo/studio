# Contributing

## Local Development

Run `mise run setup` once, then `mise run dev`. The preview uses Vite HMR, API watch mode and isolated development data. `npm run dev:demo` provides sample output without a GPU. Worker lifecycle changes remain disabled in development.

Run `mise run check`, `mise run build` and `npm run test:browser` before submitting a change. Install browsers with `npx playwright install chromium webkit`. Browser scenarios use isolated fixtures and cover desktop and phone interactions; real generation needs separate verification against the intended worker.

`frontend` owns React features, shared UI components, public assets and the Vite build. `backend` owns the API, domain operations, persistence, providers, CLI commands and bundled workflows. `shared` holds API contracts. `worker` owns the GPU image and its ComfyUI custom nodes. Root `dev.mjs` coordinates local development; release automation lives in `.github`. Follow [UI Patterns](UI-PATTERNS.md) for shared interaction rules.

Profiles, guides, catalogues, deployments and GPU placements belong in `ai`. Configure Studio with a read-only mount; user presets and generated media belong in Studio runtime data.

## Versions & Releases

`package.json` owns the version. The release entry point supports a dry run from clean, up-to-date `main`:

```sh
npm run release -- minor --dry-run
npm run release -- minor
```

Use `patch` for fixes, `minor` for new behaviour before 1.0, or an explicit newer version. The public 1.0 release requires an explicit version. Write user-visible changes under Unreleased in [CHANGELOG.md](CHANGELOG.md), beginning with a short `> ` summary.

Push the resulting version tag to publish. The Studio workflow checks source and browser behaviour, builds the frontend once, verifies and scans the app image, and invokes the worker workflow before creating a release from the changelog. Both images must pass their checks and scans before the release is announced. Worker source changes also run its workflow independently; UI-only changes do not build the GPU image. CI runs application checks and worker Python tests separately; `mise run check` runs both locally.

Batch related, verified changes. Do not release features still awaiting real-model verification. Publication and production deployment are separate actions; use the deployment repository's reviewed configuration for cutover.
