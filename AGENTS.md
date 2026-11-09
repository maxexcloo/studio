# Project Guidance

## Ownership

- This is Studio, a hard fork of HEISS UI. It no longer syncs upstream: Studio owns all of its code and may restructure any of it, including the core (model and family detection, graphs, composer, gallery, viewer).
- User-facing text, documentation, settings (`STUDIO_*`), headers, cookies, browser storage and internal identifiers say Studio. Every Studio setting starts with `STUDIO_` and old names are not read as aliases; third-party credentials keep their standard names (`HF_TOKEN`, `CIVITAI_API_TOKEN`).
- Runtime state is authoritative. Studio reads and writes only Studio names on disk (`studio` media folder, `.studio-trash`, the `studio` profile block); no legacy names or fallbacks. Runtime files are moved or renamed only by the explicit migration in `migrate-runtime` (backup, dry run, mapping, `--restore`) or an administrator's run of its steps through `POST /api/maintenance/migrations`, never implicitly.
- Keep externally used names stable: MCP tool names (lowercase snake_case with lowercase titles since November 2026, such as `generate` and `upload_link`), `/api` routes, the profile file format and result links, including the `heiss-mcp-result-link-v2` sealing label.
- Studio owns live generation profiles, prompting guides and model/LoRA catalogue definitions in its runtime data folder, including uncensored content. Administrators edit and approve them in Studio. Live data is the only source: the sample profiles in `backend/samples/` seed only a data folder that has never held a profile. Keep deployment/workload configuration in kubelab.
- The whole repository is AGPL-3.0 (`LICENSE`). Keep the MIT notices for HEISS UI, J-AI Studio and MantineHub in `NOTICE`, shipped in both images, and their credits in Settings › About and `README.md`.
- Read `UI-PATTERNS.md` before UI work. Keep this guide to cross-cutting interaction rules and apply each rule everywhere it occurs.

## Delivery

- The container image on GHCR, built and verified by CI, is the only delivery. There is no `docs/` website, desktop launcher, packaged download, self-updater or release signing; do not add them.
- Studio builds the app and `studio-worker` GPU images. Deployment configuration belongs to kubelab (`apps/base/studio`); Studio controls configured GPU workloads. Automatic lifecycle control stays off by default.
- Every green `main` commit publishes images and deploys through kubelab. CI owns versioning and releases.
- Push small changes straight to `main` and open a pull request for large ones. Merge only what is ready for production, including any real-model verification it needs.
- Take a ZFS snapshot of Studio's data before merging a change that runs a data migration.
- Single-user mode keeps working for local development.

## Verification

- Run `mise run check` after changes.
- Retain browser interaction tests in CI.
- Keep credentials and runtime data out of Git and test output.
- Tests never generate media or call cloud providers. Verify real behaviour on the live deployment, never on a local copy of production data.
