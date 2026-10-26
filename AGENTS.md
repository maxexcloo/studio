# Project Guidance

## Ownership

- This is Studio, a hard fork of HEISS UI. It no longer syncs upstream: Studio owns all of its code and may restructure any of it, including the core (model and family detection, graphs, composer, gallery, viewer).
- User-facing text, documentation, settings (`STUDIO_*`), headers, cookies, browser storage and internal identifiers say Studio. Legacy `HEISS_*` settings and the old header, cookie and storage names are read as deprecated aliases only (see `CONFIGURATION.md#renamed-settings`); never write them.
- Runtime state is authoritative. On-disk names such as the `heiss-ui` output and media folders, `.heiss-trash`, the `heissUi` profile block and `heiss_generation` job records stay until an explicit migration with a backup, dry run, mapping and recovery replaces them. Read new and old names; never move or rename runtime files implicitly.
- Keep externally used names stable unless aliased: MCP tool names, `/api` routes, the profile file format and result links. The profile block is read as `studio` or `heissUi` and written as `heissUi` until the external format is explicitly migrated.
- Studio owns live generation profiles, prompting guides and model/LoRA catalogue definitions in its runtime data folder, including NSFW content. Administrators edit and approve them in Studio. ai supplies seed/backup definitions; seeding fills only missing definitions and never overwrites runtime changes or resurrects deleted profiles. Keep deployment/workload configuration in ai.
- Keep the credit and licence notices for HEISS UI and J-AI Studio (MIT) in Settings › About, `LICENSE` and `README.md`, and the AGPL notice for the native MCP modules.
- Read `UI-PATTERNS.md` before UI work. Keep this guide to cross-cutting interaction rules and apply each rule everywhere it occurs.
- The phone UI and the standard UI are one responsive implementation (shared item actions, selection and sheets).
- Mise owns local task orchestration; npm installs dependencies and retains commands required by container builds.

## Delivery

- The container image on GHCR, built and verified by CI, is the only delivery. There is no `docs/` website, desktop launcher, packaged download, self-updater or release signing; do not add them.
- Studio builds the app image and the `studio-worker` GPU runtime image. The deployment lives in kubelab (`apps/base/studio`); GPU workloads are Kubernetes deployments switched by scaling replicas, and ai supplies seed definitions. AI Control is retired; Studio's automatic lifecycle control stays disabled until it can drive those deployments.
- A `v*` tag publishes the verified image under its version tags and a GitHub release with notes from `CHANGELOG.md`.
- Single-user mode keeps working for local development.

## Verification

- Run `mise run check` after changes.
- Retain browser interaction tests in CI.
- Keep credentials and runtime data out of Git and test output.
