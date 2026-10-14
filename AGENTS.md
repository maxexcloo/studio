# Project Guidance

## Ownership

- This is a fork of HEISS UI. Preserve upstream application, updater, launcher and release behaviour.
- Keep upstream documentation layout, workflow filenames and externally defined identifiers to simplify synchronisation.
- Local container delivery and shared verification use the pinned Mise tools.
- The Unix and Windows packaging jobs intentionally test Node 22 compatibility. Primary CI and release checks use the Mise Node version; packaged downloads retain upstream LTS selection.

## Verification

- Run `mise run check` after changes.
- Retain browser interaction tests and packaged launcher smoke tests in CI.
- Keep credentials and runtime data out of Git and test output.
