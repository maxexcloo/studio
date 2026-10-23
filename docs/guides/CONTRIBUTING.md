# Contributing

## Local Development

Run `mise run setup` once, then `mise run dev`. The preview uses Vite HMR, API watch mode and isolated development data. `npm run dev:demo` provides sample output without a GPU. Worker lifecycle changes remain disabled in development.

Run `mise run check`, `mise run build` and `npm run test:browser` before submitting a change. Install browsers with `npx playwright install chromium webkit`. Browser scenarios use isolated fixtures and cover desktop and phone interactions; real generation needs separate verification against the intended worker.

Frontend features live under `src/features`; shared API contracts live under `shared`. Queue and session operations use `server/rewrite`, persistence uses `server/persistence`, and workload admission uses `server/runtime`. Retained API/domain modules continue to provide the published HTTP and MCP contracts. Follow [UI Patterns](UI-PATTERNS.md) for shared interaction rules.

Profiles, guides, catalogues, deployments and GPU placements belong in `ai`. Configure Studio with a read-only mount; user presets and generated media belong in Studio runtime data. Custom nodes and worker packaging belong in `comfyui` and `worker` respectively.

## Versions & Releases

`package.json` owns the version. The release entry point supports a dry run from clean, up-to-date `main`:

```sh
npm run release -- minor --dry-run
npm run release -- minor
```

Use `patch` for fixes, `minor` for new behaviour before 1.0, or an explicit newer version. The public 1.0 release requires an explicit version. Write user-visible changes under Unreleased in [CHANGELOG.md](../../CHANGELOG.md), beginning with a short `> ` summary.

Push the resulting version tag to publish. The Studio workflow checks source and browser behaviour, builds the frontend once, verifies and scans the image, publishes its version tags, then creates a release from the changelog. The worker workflow independently checks and publishes the GPU image when worker sources change or a version tag is pushed.

Batch related, verified changes. Do not release features still awaiting real-model verification. Publication and production deployment are separate actions; use the deployment repository's reviewed configuration for cutover.
