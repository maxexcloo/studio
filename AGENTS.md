# Project Guidance

## Ownership

- This is a sync-friendly fork of HEISS UI. Keep core files (server model and family detection, graphs, composer, gallery, viewer) close to upstream and avoid restructuring them, so upstream model, workflow, graph and UI work merges cleanly.
- Merge upstream on a dedicated branch from current `main`, then review the differences before merging back.
- Fork features live in clearly separate modules: accounts, media storage, MCP and deployment settings.
- Keep upstream documentation layout, workflow filenames and externally defined identifiers to simplify synchronisation.
- Mise owns local task orchestration; npm installs dependencies and retains commands required by container builds.

## Delivery

- The container image on GHCR, built and verified by CI, is the only delivery. Do not reintroduce desktop launchers, packaged downloads, the self-updater or release signing; drop them when they arrive in an upstream merge.
- A `v*` tag publishes the verified image under its version tags and a GitHub release with notes from `CHANGELOG.md`.
- Single-user mode may keep working for local development but needs no exact upstream parity.

## Verification

- Run `mise run check` after changes.
- Retain browser interaction tests in CI.
- Keep credentials and runtime data out of Git and test output.
