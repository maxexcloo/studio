# Contributing

Thanks for wanting to help with Studio. It's a local front end for ComfyUI, so most changes are best tested against a real local ComfyUI server, especially anything that touches generation.

## Setup

```bash
npm install
npm run dev
```

Before opening a pull request, run:

```bash
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The browser checks run the built studio on desktop and phone viewports with temporary demo data. They cover navigation, generation completions, reference search and deferred panels without needing ComfyUI or a GPU. CI installs Chromium automatically. To use an existing Chromium locally, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable.

## Missing packages and demo mode

`npm run dev` reinstalls missing packages, so an incomplete `node_modules` folder doesn't stop it.

`npm run dev:demo` (or `STUDIO_DEMO=1`) is for agent and UI testing without a GPU. When ComfyUI is unreachable it offers fake models and returns placeholder images. It's off otherwise, so a normal install shows ComfyUI as offline instead.

`mise run dependencies:check` previews dependency updates.

## Pull requests

- Keep changes focused. One idea per PR is easier to review.
- Keep the UI consistent with what's there: dark canvas, floating pill surfaces, one white primary action, and the square pixel accent used sparingly.
- Keep server changes local-only by default.
- Document any new environment variable in `.env.example` and [CONFIGURATION.md](./CONFIGURATION.md).
- Don't commit model files, generated media, logs or `.env` files.
- New workflow templates belong in `workflows/` with a `heissUi` mapping block. See [the workflow guide](../../workflows/README.md).
- New model families (and the custom nodes, encoders or VAEs they need) follow [the model guide](./MODELS.md).
- Add a line for anything people will notice under **Unreleased** in [CHANGELOG.md](../../CHANGELOG.md).

## Versions and releases

Studio uses [Semantic Versioning](https://semver.org/). `package.json` holds the version, and every release is a `vX.Y.Z` tag with the same number.

Until the public 1.0 release, versions stay at `0.x.y`:

- **Minor** (`0.2.0` → `0.3.0`): new features. Before 1.0 this is also where breaking changes go (settings that reset, a workflow format change), called out in the changelog.
- **Patch** (`0.2.0` → `0.2.1`): fixes only, safe to take without reading the notes.
- **1.0.0** is reserved for the public announcement. The release script refuses a plain `major` bump before then, so it can only happen on purpose.

### When to release

- **Patch:** the same day a fix matters to people running a release, like a generation that fails, settings that get lost or a download that breaks.
- **Minor:** when a feature people will notice is finished and tested on real models. Batch them instead of releasing every commit; while the app changes quickly that is roughly every one to two weeks.
- **Not yet:** anything still waiting on a test with real models, or with an empty **Unreleased** section.

Before every release, on a real ComfyUI with GPU:

1. Generate with three or four model families, including one all-in-one checkpoint and one model-only file.
2. Run one native 2K picture, one upscale from the upscale arrow and one inpaint.
3. Build and start the container image (`docker build`, then the run command in the README) and check that **Settings › About** shows the version.

### Cutting a release

To cut a release, from an up-to-date `main` with the notes written under **Unreleased**, opened by a one-line summary of the release:

```markdown
## [Unreleased]

> Smoother model setup, clearer progress, calmer errors

### Added
- ...
```

Name what the release is about in a few words. With one big change, name it; with several, name the theme ("Smoother model setup and calmer errors"); with only small ones, say so ("Smaller fixes across the studio").

```bash
npm run release -- minor --dry-run   # checks the release, changes nothing
npm run release -- minor             # bump, date the changelog, commit "Release vX.Y.Z", tag
git push --atomic origin main vX.Y.Z # publishes the image and the GitHub release
```

`patch`, `minor` or an exact version like `1.0.0` all work; `--push` pushes for you. The script checks the tree is clean and in sync, the lockfile and the previous tag match `package.json`, and the **Unreleased** notes open with a `> ` summary line, then moves those notes into the new version and commits and tags it. It runs no test suites; run `mise run check` while working. Pushing the tag runs the Release workflow: it checks the tag matches `package.json`, runs the full CI checks, builds, smoke-tests and scans the container image, publishes it as `ghcr.io/maxexcloo/studio:X.Y.Z` and `:X.Y`, and creates the GitHub release with that changelog section and the image digest as its notes. There are no downloads to package or sign.

Between releases a source checkout shows how far it is past its tag in **Settings › About**, for example `v0.2.0 + 3`.

## Found a bug?

[Open an issue](https://github.com/maxexcloo/studio/issues). Say what you did, what you expected and what happened. Your ComfyUI version and the model or workflow you used help a lot.

### Ownership & Release Gates

Studio is a hard fork: it no longer merges HEISS UI and owns all of its code, so restructure any part of it when that removes real debt. Keep `origin` pointed at `maxexcloo/studio`; there is no `upstream` remote to follow. Preserve published commits and tags. Keep runtime names on disk (output and media folders, the profile `heissUi` block, job records) until an explicit, reversible migration replaces them, and keep the HEISS UI and J-AI Studio credits and licence notices.

Use `mise run release:prepare` for a non-publishing minor-release rehearsal. It checks cleanliness, the configured fork origin, the lockfile and previous tag, an unused numeric tag and the Unreleased notes and their summary line, without fetching, running the test suites, changing versions, committing, tagging or publishing. Only the untracked local `todo.md` and `questions.md` are exempt from cleanliness checks. Do not create 1.0 implicitly or reuse upstream tags.

Publication requires a tag matching `package.json` and the lockfile, project checks, build, desktop/phone interactions and the container smoke/security checks for that commit. The image is pushed as an untagged candidate, verified, and only then given its version tags.

Publication does not authorise deployment. Deployment configuration belongs in `../ai` and must pin a verified published fork image by digest. Account/data migration and retirement of old services require protected backups, explicit ownership mapping, a recovery procedure and live image/video and cross-account verification. Those gates have not been established by local demo tests.
