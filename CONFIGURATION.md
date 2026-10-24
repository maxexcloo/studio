# Configuration

Copy `.env.example` to `.env` when you need different ports or paths.

Set `STUDIO_ENABLE_BUILTIN_PROFILES=0` to use only imported workflows. This hides detected model profiles and bundled workflow templates from the generation catalogue; their definitions and model files remain intact. With a configuration mount, seeded and runtime profiles are used by default; standalone configuration keeps built-in profiles enabled. Set the switch explicitly to opt into detected model profiles.

```bash
COMFY_URL=http://127.0.0.1:8188
HOST=127.0.0.1
PORT=8787
STUDIO_DATA_DIR=./data
COMFY_OUTPUT_DIR=
```

`COMFY_OUTPUT_DIR` is optional; the folder is usually found without it. The folder is needed to delete files along with their cards. The retained configuration API accepts only a folder ComfyUI writes to (one with ComfyUI's images, or next to its `models` or `custom_nodes`). The gallery's clear operation moves finished files to `.heiss-trash` in that folder, where they wait 30 days (`STUDIO_TRASH_DAYS`) in case you want them back.

Single-user mode answers only the computer running Studio; other devices need [account mode](#multi-user-mode). `STUDIO_ALLOWED_HOSTS` lists extra names to answer to (comma-separated), and `STUDIO_TLS_CERT`, `STUDIO_TLS_KEY` and `STUDIO_HTTPS_PORT` give Studio its own HTTPS when it listens beyond this computer. See [Security](./SECURITY.md) and [Accounts & Devices](./TROUBLESHOOTING.md#accounts--devices).

With [Studio media storage](#studio-media-storage-comfyui-as-a-worker) workers need no shared storage; with ComfyUI's output folder, they must share input and output storage for local gallery access. See [Workers](#workers) for one or many ComfyUI workers.

## Workers

Studio runs on zero, one or many ComfyUI workers. Each has a stable id, a name,
an address and what it can do:

| Capability | Runs                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `image`    | Image generation, and provider-backed cloud runs (Grok), which go through a worker's provider node |
| `video`    | Local video generation                                                                             |
| `upscale`  | Upscaling finished images and videos; Smart upscale inside a run needs it on the image worker too  |
| `models`   | Receives model and LoRA downloads with `STUDIO_MODEL_STORAGE=worker`                               |

The rewrite shows configured workers in **Settings › Workers**. Deployment configuration owns their placement and connection details. The retained `/api/workers` contract can still maintain a local `workers.json` list for standalone instances.

A deployment can define the workers itself. They show as locked in Settings
and are changed only in the deployment:

```bash
STUDIO_WORKERS='[
  {"id": "primary", "name": "Image Worker", "url": "http://comfyui-image:8188", "capabilities": ["image", "upscale", "models"]},
  {"id": "video", "name": "Video Worker", "url": "http://comfyui-video:8188", "capabilities": ["video"]}
]'
```

`id` is optional (it defaults to the name in lower case) but keep it stable:
jobs, previews, cancellation and recovery after a restart follow a job's
worker by id. `STUDIO_WORKERS='[]'` runs Studio with no workers: it says so
plainly and refuses generation. A malformed value stops Studio at start with
the reason.

Without `STUDIO_WORKERS`, the older variables still work. `COMFY_URL` from the
deployment is the locked worker `primary` (Image Worker: image, upscale and
model downloads, plus video when there is no video worker) and
`COMFY_VIDEO_URL` the locked worker `video` (Video Worker: video). A
`COMFY_URL` in `.env`, or the default local address, only seeds Studio's own
list until it is first saved.

**Routing:** queued work pins its selected worker and waits while it is offline. A user may explicitly permit fallback to another worker advertising the same profile. Studio never substitutes an unavailable model or switches to a cloud provider implicitly. Worker capability checks apply before submission. Automatic GPU lifecycle control remains disabled unless the separate ownership and traffic acknowledgements are configured.

## Cloud Models

Set `STUDIO_CLIPROXYAPI_URL` to the direct CLIProxyAPI base URL and `STUDIO_CLIPROXYAPI_KEY` to its server-side credential. Existing `CLIPROXYAPI_URL`/`CLIPROXYAPI_KEY` names remain readable for compatibility with worker configuration. Runtime profiles retain their identifiers; direct generation supports single `GrokMedia` workflows whose models are advertised by the provider. Other custom provider graphs can use the existing worker bridge.

Direct cloud work is independent of GPU admission. Studio records asynchronous video request IDs and recovers them before resubmitting. A synchronous image request has no resumable provider ID: an interrupted response remains visible as unknown and is never retried automatically. Cancelling that operation ends Studio's wait; the provider may still finish or charge for work already accepted. Saved results retain the actual provider/model and the existing media result-link shape.

Cloud Models and NSFW access remain per-user permissions. Credentials never reach the browser or media-download URLs.

## Model Manifest

`STUDIO_MODEL_STORAGE=worker` selects the worker with the `models` capability
(see [Workers](#workers)) for model inventory and downloads, even when Studio has a local mirror mount. Set the same
nonempty `STUDIO_WORKER_TOKEN` on both services and mount the worker's models
read-write. Provider credentials remain in Studio; downloads stream directly to
the worker and resume against their recorded source, size and SHA-256 checksum.
Local storage uses Studio's ComfyUI model folders. Inventory and downloads in
worker mode do not inspect or change a local mirror. See
[Studio Worker Node](worker/comfyui/studio_worker/README.md).

`STUDIO_MODEL_MANIFEST` points at a pinned list of the models a deployment expects: a JSON array of `{ "path", "sha256", "size", "url"? }` entries. Each `path` is relative to ComfyUI's model folder; when the manifest's paths start with a deployment folder instead (such as `models/comfyui/`), set `STUDIO_MODEL_MANIFEST_PREFIX` to strip it.

The catalogue reads this deployment-owned metadata; manage the manifest in the deployment repository. Administrators manage model downloads in **Library › Downloads**. Downloads verify their recorded checksums and retain explicit filename conflicts.

## Studio Media Storage (ComfyUI as a Worker)

With media storage, Studio keeps every finished output in its own folder and treats ComfyUI as a stateless worker:

- Studio fetches each output over ComfyUI's HTTP API into `STUDIO_MEDIA_DIR` (`<STUDIO_DATA_DIR>/media` by default), with a folder per account.
- The [Studio worker node](worker/comfyui/studio_worker/README.md) then removes ComfyUI's copy, the run's staged inputs and its history entry.
- Studio and ComfyUI no longer need to share a folder, so they can run on different servers.

Media storage is on by default in multi-user mode. `STUDIO_OUTPUT_STORAGE=studio` turns it on for a single-user studio, and `STUDIO_OUTPUT_STORAGE=comfy` keeps ComfyUI's output folder; any other value stops Studio at startup. Set the same `STUDIO_WORKER_TOKEN` in Studio and ComfyUI to protect the worker node's endpoints.

Existing ComfyUI outputs stay where they are; only new runs, upscales and recovered runs move. If an output cannot be fetched, it keeps its ComfyUI address instead of being lost. Without the worker node, ComfyUI keeps its copies and Studio logs a warning.

## Multi-User Mode

`STUDIO_MULTI_USER=1` turns on optional accounts. It is off by default; single-user mode and device sign-in behave as before.

- **Every request needs an account,** including requests from this computer. The first visit on the computer running Studio creates the recovery administrator; after that, administrators add accounts in **Settings › Users**. Accounts sign in with their email address, which is the account's username; accounts created before this with other usernames keep signing in with them. Where nobody can open Studio on its own computer (a container platform), set `STUDIO_SETUP_TOKEN` to a random value of at least 32 characters (a shorter one stops Studio at startup): the first-administrator screen then accepts it from any address, until an account exists.
- **Single sign-on (Pocket ID or another OpenID Connect provider):** set `STUDIO_OIDC_ISSUER`, `STUDIO_OIDC_CLIENT_ID` and `STUDIO_OIDC_REDIRECT_URI` (`https://<studio>/api/accounts/oidc/callback`). Public PKCE clients need no secret; `STUDIO_OIDC_CLIENT_SECRET` supports confidential clients, and `STUDIO_OIDC_LABEL` names the button (Single Sign-On by default). Setting only some of these stops Studio at startup and names the missing ones. The provider only proves identity. A verified email that matches an account's username links that account. Any other identity becomes a pending account, which an administrator approves (onto the default group, or by assigning one), or, with a default and Require Approval off, an account on the default at once. Roles never come from the provider.
- **Probes stay open:** `/api/ping` (liveness) and `/api/ready` (readiness: the data folder is writable) answer without an account. ComfyUI workers being down does not make Studio unready.
- **Administrators** have full access. **Ordinary accounts** are in one group (an access profile on the server), which lists the local generation profiles they may use (or All, which includes ones added later) and switches for cloud models, galleries, LoRAs, NSFW models, prompt history, references and image/video generation. Cloud (Grok) profiles follow the Cloud Models feature, and a profile marked `"nsfw": true` in its `heissUi` block also needs NSFW Models. Other new generation profiles stay administrator-only until a group grants them. Presets & Civitai Imports stay administrator-only for now.
- **Default group:** Studio adds an Administrator (everything) and a User (no NSFW models, cloud models, LoRAs or presets) group when no group has those IDs. Administrators edit groups in **Settings › Groups** and pick one default group under **Settings › Users › New Account Policy**; it applies to accounts added in **Settings › Users**, to first single sign-on and to chat gateway accounts. **Require Approval** beside it (on until an administrator turns it off) keeps new single sign-on and chat gateway accounts waiting in Users; assigning an access group approves a waiting account. Turned off, they start on the default at once. Without a default, single sign-on accounts wait for approval and the gateway creates none.
- **Each account's outputs, prompt history, LoRA stacks, references and jobs are private** and saved under its own output subfolder. Ordinary accounts only reach reviewed, owner-checked routes; studio administration (models, library folders, connection, updates, presets, trash) stays with administrators. Run grouping is unavailable to accounts.
- **Personal MCP tokens** are issued once in Settings, stored only as hashes, and work only for MCP. They are never an administrator credential. Rotating or revoking a token leaves existing result links working; a result link ends when its output is hidden or deleted.
- **Records from single-user mode have no owner** and stay out of every account's gallery until they are explicitly migrated to an account.

`STUDIO_ACCOUNT_MAX_OUTSTANDING_JOBS` limits each ordinary account's queued and running generations (2 by default; anything but a positive whole number stops Studio at startup). Session cookies are marked `Secure` over HTTPS, including behind a proxy that sends `X-Forwarded-Proto: https`.

### Importing an Existing Studio

`backend/commands/import-studio.mjs` moves a whole single-user studio into one existing account of this studio. It runs against this studio's `STUDIO_DATA_DIR` and `STUDIO_MEDIA_DIR`; stop Studio first.

```bash
node backend/commands/import-studio.mjs --source-data /old/heiss/data --source-outputs /old/comfy/output --account studio --label normal         # dry run
node backend/commands/import-studio.mjs --source-data /old/heiss/data --source-outputs /old/comfy/output --account studio --label normal --apply
node backend/commands/import-studio.mjs --undo <batch>
```

- **What moves:** finished gallery outputs and their upscales (copied into the account's media folder), prompt and negative-prompt history, LoRA stacks and library, uploaded references, and MCP job and reference ownership.
- **What doesn't:** Hidden items from an older studio (they are encrypted), presets and workflow preferences (studio-wide), pending or failed records, and library-folder items. Each of these is counted in the dry run.
- **Without `--apply`,** nothing is written; the dry run lists every count and conflict.
- **The source is never changed.** Every target file that changes is backed up under `<STUDIO_DATA_DIR>/imports/<batch>/`, and `--undo` removes exactly what that import added.
- **Refused:** an import whose jobs are already in the gallery, an account that already has its own history files, or a result above `STUDIO_GALLERY_LIMIT`.

MCP clients connect in one of three ways in multi-user mode:

- **Personal token:** a client sends the account's own token.
- **Trusted gateway:** a chat gateway such as LiteLLM sends the shared `STUDIO_MCP_API_KEY` together with its own user ID in `x-ai-user-id`. Studio acts for that user only once the ID is linked to an account. When the gateway also forwards the user's email in `x-ai-user-email` and it matches an enabled, approved account's username (ignoring case), Studio links the ID to that account on its first request, recorded like an administrator's link; an unknown email creates an account only when a default access group is configured, subject to the new-account approval policy. Otherwise an administrator links the ID under **Settings › Users › Chat Gateway**, where unlinked IDs are listed; **Dismiss** removes one from the list until the gateway sends it again. Unlinked IDs still see the tools, but every call only returns a message asking for the link, so the chat explains the problem instead of reporting no tools. Unlinking an ID whose email matches an enabled account lets it link again on its next request; disable the account to stop it.
- **AI Control:** `CONTROL_MCP_API_KEY` keeps its control tools and reaches no galleries or accounts. They need `CONTROL_URL` and `CONTROL_API_KEY`; these retained external-service tools are separate from Studio’s integrated runtime controls in **Settings › Workers**.

MCP's own requests to the studio use a per-process internal credential. It is accepted only from this computer and only for MCP's routes.

### MCP Admin Tools & External Chat

Administrator MCP tools retain their published names and permission boundaries. Library transfers and downloads use the same domain services as HTTP. Administrators can edit and approve runtime-owned catalogue, profile and guide definitions through the retained mutation tools. Personal MCP tokens remain distinct from browser administrator credentials.

The retained external-chat handover contracts use `STUDIO_CHAT_URL`, `chat-handovers.json` and account-owned job relationships. They remain available for existing LibreChat consumers.

Studio's Chat tab uses its own OpenAI-compatible text gateway, configured with three server-side settings:

- `STUDIO_CHAT_GATEWAY_URL`: gateway root, `/v1` base or full `/chat/completions` endpoint.
- `STUDIO_CHAT_GATEWAY_KEY`: gateway credential, never sent to the browser.
- `STUDIO_CHAT_GATEWAY_MODELS`: comma-separated permitted model IDs or prefixes ending in `*`, such as `ai/*,deepseek/specific`. Missing or empty configuration leaves Chat unavailable. Chat only offers models actually returned by this gateway's model catalogue; the first permitted model is the default. Selected models are checked again for every message.

Chat uses the Prompt Assistant account permission; known Spicy models also require NSFW Models. Its gateway is independent of prompt assistance and `STUDIO_CHAT_URL`, which retains its external-chat handover meaning. Chat preserves the selected media model and backend. Explicit requests to create, refine or animate media use the normal generation admission path; discussion alone does not generate media. Editing and submitting a generation card records its changed settings in the conversation, then generates once after the assistant finishes its reply. Each iteration retains the assistant's text, generation inputs, actual text model and linked results. Interrupted text responses retain their partial content, and recorded media actions are not automatically resubmitted.

MCP assistant records survive a restart and preserve who prepared each generation. Results and signed links stay scoped to the owning account. Existing gateway settings remain supported while the separate Bifrost migration is pending.

`STUDIO_ENABLE_GROK=0`, `STUDIO_ENABLE_TESSERA=0` and `STUDIO_ENABLE_LORAS=0` disable those optional catalogue features for everyone, administrators included, and reject unavailable generation settings; the matching group features show as locked. All three are enabled by default and Settings no longer switches them. In account mode, a LoRAs or Cloud Models value saved earlier from Settings is carried into every group once (a group keeps a feature only where the switch had it on) and then dropped from Studio's own env file.

`STUDIO_DEFAULT_IMAGE_PROFILE` and `STUDIO_DEFAULT_VIDEO_PROFILE` optionally select the instance’s default ready workflow IDs. They apply to a fresh composer and mode changes; existing drafts remain intact. Missing or unavailable IDs fall back to the first ready profile. Reference-image variants run separately to limit GPU memory. Image workflows apply their batch count when selected; fresh image preferences default to one, while video and workflows without batch support use one.

`STUDIO_COMFY_SEARCH=0` keeps the legacy standalone worker-discovery path on its configured address. Development sets it to 0. Also, `STUDIO_THUMBNAIL_CACHE_MB` caps the gallery's thumbnail cache (2048 by default; the least recently shown go first).

Model downloads follow the Hugging Face tools' own settings. `HF_TOKEN` opens gated repos and is only sent to huggingface.co, `HF_ENDPOINT` points downloads at a mirror, and `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` send them through a proxy. Existing administrator credential APIs remain available; the rewritten settings page does not expose provider credentials.

## Civitai Images & Downloads

Imports into the **Library** are disabled by default. Set `STUDIO_ENABLE_PRESETS=1` only on instances that should offer them; keep it unset or `0` everywhere else. The server enforces this switch for saved images, thumbnails, imports, provider downloads and Civitai token settings, and the Library's Imports and Inspiration sections follow the server’s feature flag. The Library itself (LoRAs, Models and Downloads) is always there for administrators, and existing catalogue downloads remain available independently.

Open the **Library** from the navigation. **Imports** accepts a Civitai image or model link or a Hugging Face file or repository link and records each import in `library/imports/<id>.json` with its grade (Exact, Close or Partial) and reasons. A Civitai image appears in **Inspiration** and in this studio’s gallery with its prompt, generation settings, checkpoint and LoRA associations; a LoRA writes its catalogue entry; a checkpoint is recorded. Missing files wait for **Download Missing**, which queues them through the configured downloader; paid, early-access and restricted Civitai files are never downloaded and show why. Filename conflicts stay explicit. Existing saved presets migrate to gallery images when the Library opens. Imported images use the normal viewer, settings reuse, reference selection and deletion behaviour. Deleting an image keeps downloaded models.

**Use Settings** applies the image’s recipe to its installed image workflow without starting a generation. Exact resource matches use SHA-256, including renamed files. Missing LoRAs, unknown weights and unsupported resource types require attention; **Use Prompt** is available independently. Civitai metadata is optional, and additional processing such as ControlNet, high-resolution passes and CLIP skip needs a matching workflow. Imported settings cannot guarantee an identical image.

**Imports** also accepts Civitai model links (including `modelVersionId`) and Hugging Face links to individual SafeTensors or GGUF files. Local downloads use the existing resumable queue and check published SHA-256 values. Hugging Face revisions are pinned to a commit when previewed. A filename conflict is never resolved by replacing the existing file automatically.

Public imports do not require a token. Set `CIVITAI_API_TOKEN` in the server environment for resources your account can access. Tokens are kept on the server and are never returned to the browser or forwarded to the image/file CDN. Imports, image deletion and model downloads are available to administrators (in single-user mode, the computer running Studio). Provider credential changes retain the existing admin boundary; the library does not expose credential controls.

## Prompt Assistant

The prompt assistant uses the MCP prompt writer's OpenAI-compatible gateway: `STUDIO_PROMPT_WRITER_URL`, `STUDIO_PROMPT_WRITER_KEY` and `STUDIO_PROMPT_WRITER_MODEL`. Credentials remain server-side. Without the gateway, the assistant is off. Bifrost fixture compatibility is separate from live gateway verification.

- `STUDIO_ASSISTANT_MODEL`: the model that rewrites prompts, writes negatives, suggests LoRAs and describes images. Unset, it is `STUDIO_PROMPT_WRITER_MODEL`. MCP Generate keeps `STUDIO_PROMPT_WRITER_MODEL` either way.
- `STUDIO_ASSISTANT_SPICY_MODEL`: an uncensored model for the Spicy preset. Unset, Spicy is hidden and refused.

Configure these in the deployment. The retained administrator integration APIs list gateway models (`GET /v1/models`) and optional vision metadata (`supports_vision` from `GET /model/info`; unknown counts as text-only). The rewritten settings page does not expose integration editing.

The **Prompt Assistant** group feature (an access profile on the server) gates every assistant route. It is on for the built-in groups and for groups stored before it existed; turn it off per group in **Settings › Groups**. Spicy also needs **NSFW Models**. LoRA suggestions need **LoRAs**, and drafting guides and profiles is for administrators. Replies are never logged; logs carry only the operation, profile, timing and a short failure reason. Each call times out (30 s, 90 s for a streamed rewrite) and falls back: a rewrite returns the original prompt, a negative the guide's default, LoRA suggestions the word-matched candidates.

`mise run eval:assistant` replays the recorded cases in `backend/fixtures/assistant-evals/` against the live gateway, using the variables above, and scores them; `--record` writes the live replies back for review. CI only scores the recorded replies.

## Profiles, Guides & Catalogue

Studio owns editable live definitions in its data directory: profiles in `workflows/`, prompting guides in `guides/`, and catalogue changes in `library/`. Administrators edit and approve these in Library; user presets remain account-owned runtime data. Existing identifiers and the `studio`/`heissUi` mapping format are preserved.

`STUDIO_CONFIG_DIR` is a read-only ai mount for workload metadata and initial seed definitions. Its seed layout is:

```text
profiles/*.json
lora-catalogue.json
models.json
prompting.json
workloads.json
```

`STUDIO_SEED_DIR` can explicitly select a seed/export directory. Startup fills only missing files and definitions, preserving existing runtime edits and deleted-profile history. It never writes back to ai or synchronises over live definitions. Export through the retained administrator API to update the ai backup after review.

## SQLite Migration & Rollback

Native Node SQLite stores the persistent queue, sessions, Chat messages and user presets in `studio.sqlite`. Accounts, account sessions, gallery metadata and deletion markers move into its document tables through an explicit offline migration. Until that migration commits, the retained JSON stores remain authoritative. Media files and runtime directory names do not move.

Stop Studio and run a dry run against a copy of the intended data directory:

```sh
node backend/commands/migrate-runtime.mjs --data-dir /copy/of/studio-data
node backend/commands/migrate-runtime.mjs --data-dir /copy/of/studio-data --apply
```

The dry run reports source-to-table mappings, record counts, hashes and conflicts without creating a database. Apply verifies copies of affected metadata and a restore manifest under `.backups/sqlite-*` before committing all documents and its migration marker atomically. The source JSON remains untouched. Re-running never reimports stale JSON over SQLite. Protect the complete original data directory and media separately before production migration; the metadata backup covers only files this migration changes authority for.

Rehearse restoration into a separate empty directory:

```sh
node backend/commands/migrate-runtime.mjs --restore /copy/of/studio-data/.backups/sqlite-STAMP --destination /empty/restore-rehearsal
```

Verify account ownership, profile identifiers and existing result links on the copy. For rollback, stop the rewrite, retain its complete SQLite/media state, restore the verified pre-migration metadata beside the unchanged media, then start the previous application image. Do not run old and new writers against the same data directory. Post-migration work must be retained or explicitly mapped before reverting to the older JSON-only application.

Development uses `data/development` with SQLite migration applied only to that isolated directory. Recovery follows recorded job IDs and never scans or adopts a shared worker's full history.

## Queue, Sessions & Runtime Control

`/api/sessions` stores generation inputs and result relationships; `/api/queue` exposes queued, waiting, starting, running, saving, completed, failed and cancelled operations. Users can cancel their pending jobs and retry failed jobs. Recorded provider jobs are recovered before any resubmission. Ambiguous submission outcomes stay visible for investigation rather than creating duplicate generations.

Work waits for the selected worker by default. Independent resources can run concurrently. A worker's admission remains held until results are safely saved; text admission remains held until its response stream drains. Runtime status is administrator-only.

The `studio` mapping in each `ai/workloads.json` entry names an existing container, one fixed GPU placement and a direct worker URL. Configure the forwarded Docker Engine and text-admission credentials only on the server; see [worker operations](worker/README.md) for their single configuration reference. Automatic control is disabled by default and requires explicit ownership and traffic acknowledgements before enabling it.

Bifrost remains a separate text gateway. It calls `/api/local-text/v1/chat/completions` for managed local text; that endpoint calls Radiance directly. Live Bifrost verification and the separate LiteLLM migration remain pending. Existing assistant gateway settings continue to work during that migration.

## Hidden Removal

Studio no longer has Hidden. The first start of a version without it backs up and converts what an older Hidden left in the data folder, once, and deletes nothing:

- **The backup** goes to `<STUDIO_DATA_DIR>/backups/hidden-removal-<time>/` (readable by the server's user only). It holds copies of `gallery.json`, `gallery-hidden.json`, `privacy.json` and `hidden-runs.json` where they existed, the encrypted `.private-vault` folder moved in whole, and a `summary.json` and `README.txt` saying what changed. The backup is written even on a studio that never used Hidden, so a deployment can confirm the step ran.
- **Into the gallery:** gallery records still flagged as Hidden become ordinary gallery items, and records that a delete marker in `gallery-hidden.json` kept out of view come back. Markers for deleted and cleared outputs stay, so those don't return from ComfyUI's history.
- **Still encrypted:** images inside the vault can't be opened without the owner's Hidden password, so they stay as ciphertext in the backup. `summary.json` counts them, and the server log warns once. Prompts sealed by the older scheme are cleared from the gallery records; the backup's copy of `gallery.json` keeps them.

`<STUDIO_DATA_DIR>/.hidden-removed-v1` records that the step finished. Remove it only to run the step again.

## Renamed Settings

Studio became a hard fork of HEISS UI and renamed its `HEISS_*` settings to `STUDIO_*`. The old names still work as deprecated aliases: Studio reads the new name first and falls back to the old one, and the log gets one line naming the old ones still in use. Saving a setting from Settings writes the new name to Studio's settings file and drops the old line. Compose also still reads `HEISS_DOCKER_COMFY_URL` when `STUDIO_DOCKER_COMFY_URL` is unset. Rename them in your deployment when convenient; a later release removes the aliases.

| Old                             | New                              |
| ------------------------------- | -------------------------------- |
| `HEISS_ALLOWED_HOSTS`           | `STUDIO_ALLOWED_HOSTS`           |
| `HEISS_COMFY_LOST_AFTER_MS`     | `STUDIO_COMFY_LOST_AFTER_MS`     |
| `HEISS_COMFY_ROOT`              | `STUDIO_COMFY_ROOT`              |
| `HEISS_COMFY_SEARCH`            | `STUDIO_COMFY_SEARCH`            |
| `HEISS_DATA_DIR`                | `STUDIO_DATA_DIR`                |
| `HEISS_DEFAULT_COMFY_URL`       | `STUDIO_DEFAULT_COMFY_URL`       |
| `HEISS_DEMO`                    | `STUDIO_DEMO`                    |
| `HEISS_DEV_PROXY_TOKEN`         | `STUDIO_DEV_PROXY_TOKEN`         |
| `HEISS_DOCKER_HOST_ONLY`        | `STUDIO_DOCKER_HOST_ONLY`        |
| `HEISS_ENABLE_INPAINT`          | `STUDIO_ENABLE_INPAINT`          |
| `HEISS_ENV_FILE`                | `STUDIO_ENV_FILE`                |
| `HEISS_FFMPEG_PATH`             | `STUDIO_FFMPEG_PATH`             |
| `HEISS_GALLERY_CHANGELOG_LIMIT` | `STUDIO_GALLERY_CHANGELOG_LIMIT` |
| `HEISS_GALLERY_LIMIT`           | `STUDIO_GALLERY_LIMIT`           |
| `HEISS_GALLERY_SAVE_MS`         | `STUDIO_GALLERY_SAVE_MS`         |
| `HEISS_HTTPS_PORT`              | `STUDIO_HTTPS_PORT`              |
| `HEISS_PREVIEW_INTERVAL_MS`     | `STUDIO_PREVIEW_INTERVAL_MS`     |
| `HEISS_REFERENCE_MAX_BYTES`     | `STUDIO_REFERENCE_MAX_BYTES`     |
| `HEISS_REFERENCE_MAX_PIXELS`    | `STUDIO_REFERENCE_MAX_PIXELS`    |
| `HEISS_SEEDVR2_HF_REPO`         | `STUDIO_SEEDVR2_HF_REPO`         |
| `HEISS_SEEDVR2_MODEL_DIR`       | `STUDIO_SEEDVR2_MODEL_DIR`       |
| `HEISS_TERMINAL_JOB_TTL_MS`     | `STUDIO_TERMINAL_JOB_TTL_MS`     |
| `HEISS_THUMBNAIL_CACHE_MB`      | `STUDIO_THUMBNAIL_CACHE_MB`      |
| `HEISS_TLS_CERT`                | `STUDIO_TLS_CERT`                |
| `HEISS_TLS_KEY`                 | `STUDIO_TLS_KEY`                 |
| `HEISS_TRASH_DAYS`              | `STUDIO_TRASH_DAYS`              |
| `HEISS_VIDEO_PREVIEW_CACHE_MB`  | `STUDIO_VIDEO_PREVIEW_CACHE_MB`  |

The same goes for the names browsers and scripts see. Studio writes only the new ones and reads the old ones until a later release:

| What                                    | Old               | New                | Compatibility       |
| --------------------------------------- | ----------------- | ------------------ | ------------------- |
| Request header for changes from scripts | `X-HEISS`         | `X-Studio`         | Both accepted       |
| Sign-in needed (401 response)           | `X-HEISS-Sign-In` | `X-Studio-Sign-In` | The page reads both |

The rewritten frontend uses Studio browser preferences. It does not import legacy browser drafts or LoRA favourites; saved gallery records and server-side sessions remain authoritative.

Accounts already use `studio_account`, so account sessions are unaffected.

## On-Disk Names

Some names on disk still come from HEISS UI. Gallery records, account media and ComfyUI's output folder hold these paths, so Studio keeps writing them and never moves or renames files by itself. It already recognises the Studio name beside each one (`backend/data-names.js`), so files a migration has moved keep working.

| Kept name                                     | Where                                                                                                 | Studio name it also reads                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `heiss-ui/` (and `heiss-ui/accounts/<hash>/`) | ComfyUI's output folder and `STUDIO_MEDIA_DIR` (for example `/data/media/heiss-ui`)                   | `studio/`                                      |
| `.heiss-trash/`                               | Beside trashed files in the output and media folders                                                  | `.studio-trash/` (skipped by snapshots)        |
| `heiss_generation`                            | Run records in ComfyUI's queue and history                                                            | `studio_generation` (written now)              |
| `heissUi`                                     | The mapping block in workflow and profile files (`/data/workflows`, the `ai/profiles/` configuration) | `studio` (read; Studio still writes `heissUi`) |
| `heiss_*` sections, `.heiss-backup`           | ComfyUI's `extra_model_paths.yaml` (single-user mode)                                                 | Not renamed                                    |
| `heiss` text chunk                            | Metadata in PNGs Studio wrote                                                                         | Not renamed                                    |
| `heiss-ui-reference-*`, `heiss-ui-upscale-*`  | File names in ComfyUI's input folder                                                                  | Not renamed                                    |

Logs are now `studio-YYYY-MM-DD.log`; older `heiss-*.log` files are still pruned after a week.

### Moving to Studio Names Later

A later release adds an explicit migration command. It is never run automatically. Until then, nothing needs to change.

1. **Back up.** Stop Studio (scale it to zero), then snapshot the data volume (`/data`, on kimbap's `truenas-nvme/studio` dataset) and, with ComfyUI's output folder, that folder too. Keep the snapshots until the migrated studio has run for a while.
2. **Dry run (default).** The command lists every mapping it would apply and changes nothing:
   - folders: `<media>/heiss-ui` → `<media>/studio`, `<output>/heiss-ui` → `<output>/studio`, and each `.heiss-trash` → `.studio-trash`
   - records: each gallery, history, trash and comparison record whose `subfolder` or `/media`, `/comfy/view` and thumbnail URL starts with `heiss-ui/` (counted per account)
   - refusals: a target folder that already exists and differs, a record that points at a missing file, or a running Studio.
3. **Apply (`--apply`).** It writes a mapping manifest first (every old → new path and record ID), renames the folders (a rename on the same file system, so no copy), rewrites the records, verifies the record and file counts against the dry run, and writes a marker so a second run does nothing.
4. **Switch.** The release that ships the command changes `outputFolderName` and `trashFolderName` in `backend/data-names.js` to the Studio names; the old names stay readable for one more release.
5. **Recovery.** `--undo <manifest>` renames the folders back and restores the records from the backups the apply step made. If anything else is wrong, restore the snapshots from step 1 and redeploy the previous image.

The profile block is a file format shared with the `ai/profiles/` configuration. Studio reads both `studio` and `heissUi` (a file with both is refused by the profile check), and retains `heissUi` output for external format compatibility; changing that format requires an explicit migration.
