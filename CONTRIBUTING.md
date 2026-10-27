# Contributing

## Local Development

Set up, run and check Studio as described in [Development](README.md#development).

`frontend` owns React features, shared UI components, public assets and the Vite build. `backend` owns the API, domain operations, persistence, providers, CLI commands and bundled workflows. `shared` holds API contracts. `worker` owns the GPU image and its ComfyUI custom nodes. Root `dev.mjs` coordinates local development; release automation lives in `.github`. Follow [UI Patterns](UI-PATTERNS.md) for shared interaction rules.

Studio owns editable profiles, guides and catalogue definitions alongside user presets and generated media in its runtime data. `ai` supplies missing-definition seeds and backups through a read-only configuration mount; deployment and GPU placement configuration remain in `ai`.

## Versions & Releases

`package.json` owns the version. The release entry point supports a dry run from clean, up-to-date `main`:

```sh
npm run release -- minor --dry-run
npm run release -- minor
```

Use `patch` for fixes, `minor` for new behaviour before 1.0, or an explicit newer version. The public 1.0 release requires an explicit version. Write user-visible changes under Unreleased in [CHANGELOG.md](CHANGELOG.md), beginning with a short `> ` summary.

Push the resulting version tag to publish. On `main`, the Studio workflow checks source and browser behaviour, builds the frontend once, smoke-tests the app image and publishes it as `sha-<commit>`; worker source changes run the worker workflow, which does the same for the GPU image, and UI-only changes do not build it. The version tag rebuilds nothing: it waits for `main`'s verified app image for the release commit, gives it and the latest verified worker image the version tags, then creates the release from the changelog. CI runs application checks and worker Python tests separately; `mise run check` runs both locally.

Batch related, verified changes. Do not release features still awaiting real-model verification. Publication and production deployment are separate actions; use the deployment repository's reviewed configuration for cutover.
