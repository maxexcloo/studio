# Project Guidance

## Ownership

- This is a fork of HEISS UI. Preserve upstream application, updater, launcher and release behaviour.
- Keep upstream documentation layout, workflow filenames and externally defined identifiers to simplify synchronisation.
- Mise owns local task orchestration; npm installs dependencies and retains commands required by upstream packaging and container builds.
- The Unix and Windows packaging jobs intentionally test Node 22 compatibility. Primary CI and release checks use the globally configured Mise Node version; packaged downloads retain upstream LTS selection.

## Verification

- Run `mise run check` after changes.
- Retain browser interaction tests and packaged launcher smoke tests in CI.
- Keep credentials and runtime data out of Git and test output.
