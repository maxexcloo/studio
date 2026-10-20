# Project Guidance

## Ownership

- This is Studio, a sync-friendly fork of HEISS UI. User-facing text and documentation say Studio, and fork-owned settings use `STUDIO_*`. Upstream's `HEISS_*` settings, internal identifiers, headers, cookies and data paths keep upstream's names; rename new user-facing "HEISS UI" text that arrives in upstream merges.
- Keep core files (server model and family detection, graphs, composer, gallery, viewer) close to upstream and avoid restructuring them, so upstream model, workflow, graph and UI work merges cleanly.
- Read `docs/guides/UI-PATTERNS.md` before UI work. When a better pattern appears, update it and apply it everywhere the pattern occurs.
- Exception: Studio owns the phone UI and merges it with the standard UI into one responsive implementation (shared item actions, selection and sheets). Port upstream phone and gallery-action changes by hand instead of merging them.
- Merge upstream on a dedicated branch from current `main`, then review the differences before merging back.
- Fork features live in clearly separate modules: accounts, media storage, MCP and deployment settings.
- Keep upstream documentation layout, workflow filenames and externally defined identifiers to simplify synchronisation.
- Mise owns local task orchestration; npm installs dependencies and retains commands required by container builds.

## Delivery

- The container image on GHCR, built and verified by CI, is the only delivery. Do not reintroduce the `docs/` website, desktop launchers, packaged downloads, the self-updater or release signing; drop them when they arrive in an upstream merge.
- A `v*` tag publishes the verified image under its version tags and a GitHub release with notes from `CHANGELOG.md`.
- Single-user mode may keep working for local development but needs no exact upstream parity.

## Verification

- Run `mise run check` after changes.
- Retain browser interaction tests in CI.
- Keep credentials and runtime data out of Git and test output.
