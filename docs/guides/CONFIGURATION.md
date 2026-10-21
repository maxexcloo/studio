# Configuration

Copy `.env.example` to `.env` when you need different ports or paths.

Set `STUDIO_ENABLE_BUILTIN_PROFILES=0` to use only imported workflows. This hides detected model profiles and bundled workflow templates from the generation catalogue; their definitions and model files remain intact. Built-in profiles are enabled by default.

```bash
COMFY_URL=http://127.0.0.1:8188
HOST=127.0.0.1
PORT=8787
STUDIO_DATA_DIR=./data
COMFY_OUTPUT_DIR=
```

`COMFY_OUTPUT_DIR` is optional; the folder is usually found without it. The folder is needed to delete files along with their cards. Settings only accepts a folder ComfyUI writes to (one with ComfyUI's images, or next to its `models` or `custom_nodes`). **Delete all finished images** moves them to `.heiss-trash` in that folder, where they wait 30 days (`STUDIO_TRASH_DAYS`) in case you want them back.

For other devices: `STUDIO_ALLOWED_HOSTS` (extra names to answer to, comma-separated), `STUDIO_DEVICE_SESSION_DAYS` (how long a device stays signed in, 1 to 30 days, 7 by default), and `STUDIO_TLS_CERT`, `STUDIO_TLS_KEY` and `STUDIO_HTTPS_PORT` for HTTPS. See [Other devices](./SECURITY.md#other-devices-signing-in-admin-https-and-proxies) and [Phones and other devices](./TROUBLESHOOTING.md#phones-and-other-devices).

With [Studio media storage](#studio-media-storage-comfyui-as-a-worker) workers need no shared storage; with ComfyUI's output folder, they must share input and output storage for local gallery access. See [Workers](#workers) for one or many ComfyUI workers.

## Workers

Studio runs on zero, one or many ComfyUI workers. Each has a stable id, a name,
an address and what it can do:

| Capability | Runs |
| --- | --- |
| `image` | Image generation, and provider-backed cloud runs (Grok), which go through a worker's provider node |
| `video` | Local video generation |
| `upscale` | Upscaling finished images and videos; Smart upscale inside a run needs it on the image worker too |
| `models` | Receives model and LoRA downloads with `STUDIO_MODEL_STORAGE=worker` |

Administrators add, edit, test, restart and remove workers in **Settings ›
Workers**. Studio keeps its own list in `workers.json` in the data folder and
never writes over it except when an administrator saves.

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

**Routing:** a job goes to a worker with the capability it needs. With several,
Studio prefers one that answered and already has the model, then the first
that answered, in list order (Smart upscale also prefers one with `upscale`).
It never sends work to a worker without the capability, never falls back to
the cloud and never changes GPU allocation; switching what a GPU runs stays in
AI Control's own UI and Mise. The first worker with `image` is the default
worker: single-worker conveniences (the output folder, finding ComfyUI on its own,
restart progress) belong to it.

## Model Manifest

`STUDIO_MODEL_STORAGE=worker` selects the worker with the `models` capability
(see [Workers](#workers)) for model inventory and downloads, even when Studio has a local mirror mount. Set the same
nonempty `STUDIO_WORKER_TOKEN` on both services and mount the worker's models
read-write. Provider credentials remain in Studio; downloads stream directly to
the worker and resume against their recorded source, size and SHA-256 checksum.
The default local backend remains unchanged. Manifest import, verification and
restore are unavailable in worker mode, so they cannot accidentally inspect or
change a mirror. See [Studio Worker Node](../../comfyui/studio_worker/README.md).

`STUDIO_MODEL_MANIFEST` points at a pinned list of the models a deployment expects: a JSON array of `{ "path", "sha256", "size", "url"? }` entries. Each `path` is relative to ComfyUI's model folder; when the manifest's paths start with a deployment folder instead (such as `models/comfyui/`), set `STUDIO_MODEL_MANIFEST_PREFIX` to strip it.

**Settings › Models › Model Manifest** shows which files are verified, present, missing or wrong. It verifies checksums in the background, and restores missing files through Studio's checksum-verifying downloader. Only Civitai and Hugging Face files that go straight into a model folder are restored; others are listed with the reason, for the deployment's own tooling.

An administrator can import another manifest or export the one in use. The deployment's file stays the disaster-recovery record.

## Studio Media Storage (ComfyUI as a Worker)

With media storage, Studio keeps every finished output in its own folder and treats ComfyUI as a stateless worker:

- Studio fetches each output over ComfyUI's HTTP API into `STUDIO_MEDIA_DIR` (`<STUDIO_DATA_DIR>/media` by default), with a folder per account.
- The [Studio worker node](../../comfyui/studio_worker/README.md) then removes ComfyUI's copy, the run's staged inputs and its history entry.
- Studio and ComfyUI no longer need to share a folder, so they can run on different servers.

Media storage is on by default in multi-user mode. `STUDIO_OUTPUT_STORAGE=studio` turns it on for a single-user studio, and `STUDIO_OUTPUT_STORAGE=comfy` keeps ComfyUI's output folder; any other value stops Studio at startup. Set the same `STUDIO_WORKER_TOKEN` in Studio and ComfyUI to protect the worker node's endpoints.

Existing ComfyUI outputs stay where they are; only new runs, upscales and recovered runs move. If an output cannot be fetched, it keeps its ComfyUI address instead of being lost. Without the worker node, ComfyUI keeps its copies and Studio logs a warning.

## Multi-User Mode

`STUDIO_MULTI_USER=1` turns on optional accounts. It is off by default; single-user mode and device sign-in behave as before.

- **Every request needs an account,** including requests from this computer. The first visit on the computer running Studio creates the recovery administrator; after that, administrators add accounts in **Settings › Users**. Accounts sign in with their email address, which is the account's username; accounts created before this with other usernames keep signing in with them. Where nobody can open Studio on its own computer (a container platform), set `STUDIO_SETUP_TOKEN` to a random value of at least 32 characters (a shorter one stops Studio at startup): the first-administrator screen then accepts it from any address, until an account exists.
- **Single sign-on (Pocket ID or another OpenID Connect provider):** set `STUDIO_OIDC_ISSUER`, `STUDIO_OIDC_CLIENT_ID` and `STUDIO_OIDC_REDIRECT_URI` (`https://<studio>/api/accounts/oidc/callback`). Public PKCE clients need no secret; `STUDIO_OIDC_CLIENT_SECRET` supports confidential clients, and `STUDIO_OIDC_LABEL` names the button (Single Sign-On by default). Setting only some of these stops Studio at startup and names the missing ones. The provider only proves identity. A verified email that matches an account's username links that account. Any other identity becomes a pending account, which an administrator approves (onto the default access profile, or by assigning one), or, with a default and Require Approval off, an account on the default at once. Roles never come from the provider.
- **Probes stay open:** `/api/ping` (liveness) and `/api/ready` (readiness: the data folder is writable) answer without an account. ComfyUI workers being down does not make Studio unready.
- **Administrators** have full access. **Ordinary accounts** get one access profile, which lists the local generation profiles they may use (or All, which includes ones added later) and switches for cloud models, galleries, LoRAs, NSFW models, prompt history, references and image/video generation. Cloud (Grok) profiles follow the Cloud Models feature, and a profile marked `"nsfw": true` in its `heissUi` block also needs NSFW Models. Other new generation profiles stay administrator-only until a profile grants them. Presets & Civitai Imports stay administrator-only for now.
- **Default access profile:** Studio adds an Administrator (everything) and a User (no NSFW models, cloud models, LoRAs or presets) access profile when no profile has those IDs. An administrator picks one default access profile in **Settings › Users › Accounts**; it applies to accounts added there, to first single sign-on and to chat gateway accounts. **Require Approval** beside it (on until an administrator turns it off) keeps new single sign-on and chat gateway accounts waiting in Users; **Approve** gives a waiting account the default. Turned off, they start on the default at once. Without a default, single sign-on accounts wait for approval and the gateway creates none.
- **Each account's outputs, prompt history, LoRA stacks, references and jobs are private** and saved under its own output subfolder. Ordinary accounts only reach reviewed, owner-checked routes; studio administration (models, library folders, connection, updates, presets, trash) stays with administrators. Run grouping is unavailable to accounts.
- **Personal MCP tokens** are issued once in Settings, stored only as hashes, and work only for MCP. They are never an administrator credential. Rotating or revoking a token leaves existing result links working; a result link ends when its output is hidden or deleted.
- **Records from single-user mode have no owner** and stay out of every account's gallery until they are explicitly migrated to an account.

`STUDIO_ACCOUNT_MAX_OUTSTANDING_JOBS` limits each ordinary account's queued and running generations (2 by default; anything but a positive whole number stops Studio at startup). Session cookies are marked `Secure` over HTTPS, including behind a proxy that sends `X-Forwarded-Proto: https`.

### Importing an Existing Studio

`scripts/import-studio.mjs` moves a whole single-user studio into one existing account of this studio. It runs against this studio's `STUDIO_DATA_DIR` and `STUDIO_MEDIA_DIR`; stop Studio first.

```bash
node scripts/import-studio.mjs --source-data /old/heiss/data --source-outputs /old/comfy/output --account studio --label normal         # dry run
node scripts/import-studio.mjs --source-data /old/heiss/data --source-outputs /old/comfy/output --account studio --label normal --apply
node scripts/import-studio.mjs --undo <batch>
```

- **What moves:** finished gallery outputs and their upscales (copied into the account's media folder), prompt and negative-prompt history, LoRA stacks and library, uploaded references, and MCP job and reference ownership.
- **What doesn't:** Hidden items from an older studio (they are encrypted), presets and workflow preferences (studio-wide), pending or failed records, and library-folder items. Each of these is counted in the dry run.
- **Without `--apply`,** nothing is written; the dry run lists every count and conflict.
- **The source is never changed.** Every target file that changes is backed up under `<STUDIO_DATA_DIR>/imports/<batch>/`, and `--undo` removes exactly what that import added.
- **Refused:** an import whose jobs are already in the gallery, an account that already has its own history files, or a result above `STUDIO_GALLERY_LIMIT`.

MCP clients connect in one of three ways in multi-user mode:

- **Personal token:** a client sends the account's own token.
- **Trusted gateway:** a chat gateway such as LiteLLM sends the shared `STUDIO_MCP_API_KEY` together with its own user ID in `x-ai-user-id`. Studio acts for that user only once the ID is linked to an account. When the gateway also forwards the user's email in `x-ai-user-email` and it matches an enabled, approved account's username (ignoring case), Studio links the ID to that account on its first request, recorded like an administrator's link; it never creates accounts this way. Otherwise an administrator links the ID under **Settings › Users › Chat Gateway Users**, where unlinked IDs are listed; **Dismiss** removes one from the list until the gateway sends it again. Unlinked IDs still see the tools, but every call only returns a message asking for the link, so the chat explains the problem instead of reporting no tools. Unlinking an ID whose email matches an enabled account lets it link again on its next request; disable the account to stop it.
- **AI Control:** `CONTROL_MCP_API_KEY` keeps its control tools and reaches no galleries or accounts. They need `CONTROL_URL` and `CONTROL_API_KEY`; nothing else in Studio uses AI Control, which has no panel in Settings.

MCP's own requests to the studio use a per-process internal credential. It is accepted only from this computer and only for MCP's routes.

### MCP Admin Tools

An administrator's chat can manage the Library, downloads, the catalogue, profiles and guides with eleven more tools (see the README's MCP section). They call the same routes as the UI with the administrator's credential, so the same checks, Undo and versions apply, and every import, catalogue edit and version they make records `chat` as its origin.

- **Who gets them:** an administrator account's own MCP token. A chat user linked through the trusted gateway to an administrator account gets them only while **Settings › Users › Chat Gateway › Chat Gateway Admin Tools** is on; it is off by default and stored with the accounts. Ordinary accounts, unlinked or anonymous gateway users, AI Control's key and the single-user shared key never get them.
- **What they reach:** only the Library, model download, catalogue, profile, guide and export routes. A personal token is otherwise still no administrator credential. Nothing deletes a file or replaces a download, Cancel only stops one (its partial file stays for Resume), and no tool touches a GPU.
- **Export links** are signed with `MCP_SIGNING_KEY`, last an hour and serve the bundle Export wrote under `exports/`.

### Refine in Chat

`STUDIO_CHAT_URL` is the chat's base address, such as `https://chat.example.com` for LibreChat. With it, **Refine** in a result's Details opens `<STUDIO_CHAT_URL>/c/new?prompt=…`, which LibreChat (v0.8.8 and later) fills into a new chat's message box without sending: the result's prompt, profile, how the prompt was written and its stable job ID, in the Handover summary's form. Without it, Refine copies the same message for pasting. The handover is kept for 30 days in `chat-handovers.json`; when that account's chat names the job, MCP takes it into the account's chat jobs, so Review, Reuse and Result work on it. Only the account that owns a result can hand it over.

What the chat's RewritePrompt and SuggestLoras did is kept for six hours in `mcp-assistant.json` beside `mcp-ownership.json`, so a later Generate still records it on its results after a restart. Each result's record also travels in its ComfyUI run (`extra_data.studio_generation.assistant`), so results rebuilt from ComfyUI's history keep it.

`Status` and `Result` wait at most 20 seconds for a job, so a chat model that waits in the foreground cannot block its chat. A `Result` with `delivery=notification`, which hosts run in the background, waits up to 1500 seconds, below LibreChat's 1800-second background deadline. MCP keeps each account's model list for up to a minute; rescanning models in the studio refreshes it at once.

`STUDIO_ENABLE_GROK=0`, `STUDIO_ENABLE_TESSERA=0` and `STUDIO_ENABLE_LORAS=0` disable those optional catalogue features for everyone, administrators included, and reject unavailable generation settings; the matching access-profile options show as locked. All three are enabled by default and Settings no longer switches them. In account mode, a LoRAs or Cloud Models value saved earlier from Settings is carried into every access profile once (a profile keeps a feature only where the switch had it on) and then dropped from Studio's own env file.

`STUDIO_DEFAULT_IMAGE_PROFILE` and `STUDIO_DEFAULT_VIDEO_PROFILE` optionally select the instance’s default ready workflow IDs. They apply to a fresh composer and mode changes; existing drafts remain intact. Missing or unavailable IDs fall back to the first ready profile. Reference-image variants run separately to limit GPU memory. Image workflows apply their batch count when selected; fresh image preferences default to one, while video and workflows without batch support use one.

Also optional: `STUDIO_COMFY_SEARCH=0` keeps Studio on the default worker's address (by default, when that doesn't answer, Studio looks on 8188 and 8000 and switches to whatever ComfyUI answers there), and `STUDIO_THUMBNAIL_CACHE_MB` caps the gallery's thumbnail cache (2048 by default; the least recently shown go first).

Model downloads follow the Hugging Face tools' own settings. `HF_TOKEN` (or a token saved in **Settings › Models**) opens gated repos and is only sent to huggingface.co, `HF_ENDPOINT` points downloads at a mirror, and `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` send them through a proxy.

## Civitai Images & Downloads

Imports into the **Library** are disabled by default. Set `STUDIO_ENABLE_PRESETS=1` only on instances that should offer them; keep it unset or `0` everywhere else. The server enforces this switch for saved images, thumbnails, imports, provider downloads and Civitai token settings, and the Library's Import and Images pages follow the server’s feature flag. The Library itself (LoRAs, Models and Downloads) is always there for administrators, and existing catalogue downloads remain available independently.

Open the **Library** from the desktop dock or the phone Menu. **Import** accepts a Civitai image or model link or a Hugging Face file or repository link and records each import in `library/imports/<id>.json` with its grade (Exact, Close or Partial) and reasons. A Civitai image lands in **Images** and in this studio’s gallery with its prompt, generation settings, checkpoint and LoRA associations; a LoRA writes its catalogue entry; a checkpoint is recorded. Missing files wait for **Download Missing**, which queues them through the configured downloader; paid, early-access and restricted Civitai files are never downloaded and show why. Filename conflicts stay explicit. Existing saved presets migrate to gallery images when the Library opens. Imported images use the normal viewer, settings reuse, reference selection and deletion behaviour. Deleting an image keeps downloaded models.

**Use Settings** applies the image’s recipe to its installed image workflow without starting a generation. Exact resource matches use SHA-256, including renamed files. Missing LoRAs, unknown weights and unsupported resource types require attention; **Use Prompt** is available independently. Civitai metadata is optional, and additional processing such as ControlNet, high-resolution passes and CLIP skip needs a matching workflow. Imported settings cannot guarantee an identical image.

**Models** accepts Civitai model links (including `modelVersionId`) and Hugging Face links to individual SafeTensors or GGUF files. Local downloads use the existing resumable queue and check published SHA-256 values. Hugging Face revisions are pinned to a commit when previewed. A filename conflict is never resolved by replacing the existing file automatically.

Public imports do not require a token. Set `CIVITAI_API_TOKEN` in the server environment for resources your account can access. Tokens are kept on the server and are never returned to the browser or forwarded to the image/file CDN. Imports, image deletion and model downloads are available at the server or from a signed-in device. Provider credential changes retain the existing admin boundary; the library does not expose credential controls.

## Prompt Assistant

The prompt assistant uses the MCP prompt writer's LiteLLM gateway: `STUDIO_PROMPT_WRITER_URL`, `STUDIO_PROMPT_WRITER_KEY` and `STUDIO_PROMPT_WRITER_MODEL` (see the README's MCP section). It adds no provider key, and LiteLLM budgets are its only limit. Without the gateway, the assistant is off.

- `STUDIO_ASSISTANT_MODEL`: the model that rewrites prompts, writes negatives, suggests LoRAs and describes images. Unset, it is `STUDIO_PROMPT_WRITER_MODEL`. MCP Generate keeps `STUDIO_PROMPT_WRITER_MODEL` either way.
- `STUDIO_ASSISTANT_SPICY_MODEL`: an uncensored model for the Spicy preset. Unset, Spicy is hidden and refused.

Administrators choose both in **Settings › Models › Integrations**, which lists the gateway's models (`GET /v1/models`) and shows whether each one reads reference images (`supports_vision` from LiteLLM's `GET /model/info`; unknown counts as text-only). A deployment that sets either variable locks its row. Choices apply at once.

The **Prompt Assistant** access-profile feature gates every assistant route. It is on for the built-in profiles and for access profiles stored before it existed; turn it off per profile. Spicy also needs **NSFW Models**. LoRA suggestions need **LoRAs**, and drafting guides and profiles is for administrators. Replies are never logged; logs carry only the operation, profile, timing and a short failure reason. Each call times out (30 s, 90 s for a streamed rewrite) and falls back: a rewrite returns the original prompt, a negative the guide's default, LoRA suggestions the word-matched candidates.

`mise run eval:assistant` replays the recorded cases in `server/fixtures/assistant-evals/` against the live gateway, using the variables above, and scores them; `--record` writes the live replies back for review. CI only scores the recorded replies.

## Studio-Owned Catalogue, Profiles & Guides

These files live in the data folder (`STUDIO_DATA_DIR`, `/data` in Kubelab). Each one is written atomically by a single module. The first start of a new version snapshots the small state files first (`.backups/`), and every migration below is safe to run again.

- **`library/catalogue.json`:** one entry per model file, keyed by `folder/file`, with hash, size, title, triggers, strength, licence, links and provenance (`origin`, `source`, `by`, the last 20 changes). It takes in `config/lora-catalogue.json` (seed), `lora-catalogue.json` (installed by hand, wins over the seed), `model-download-sources.json` (provider links and hashes), `model-hashes.json` (hashes of unchanged files) and the restore manifest. Those files are never written or removed: a changed file refreshes its layer, and a removed one keeps its last copy. Studio's own catalogue edits sit above all of them.
- **`guides/prompting.json`:** the prompting guides, in `prompting.json`'s schema plus `meta.<packId>` (version, origin, AI-Drafted). The first start copies the seed in as version 1. After that the seed only adds packs and bindings the store doesn't have: a pack Studio holds is never replaced, whoever last changed it. The guide loader reads this file first, falling back to the seed.
- **`history/profiles/<id>/<n>.json` and `history/guides/<packId>/<n>.json`:** immutable versions, recording who saved each one (an account, `assistant`, `chat` or `seed`). The first start records each profile's `backups/profile-edits` copies and current file as versions: the oldest is `seed`, and later ones are `studio` when `.studio-edits.json` lists the profile. A revert saves an earlier version as a new one.
- **`workflows/.studio-meta.json`:** each profile's current version, origin, AI-Drafted marker, editor, seed hash and last exported hash. `workflows/.studio-edits.json` is still written for every profile Studio changed or drafted.
- **`exports/studio-profiles-<time>.zip`:** the 20 newest exports (see [Seed, Export & the Retired Deploy](#seed-export--the-retired-deploy)).

### Seed, Export & the Retired Deploy

Studio is the only writer of live profiles and prompting guides. The profiles repository (`ai/profiles/`) is their **seed and backup**, and `mise run profiles:deploy` is **retired**: do not run it against a Studio data folder. Changes flow one way, Studio → **Settings › Profiles › Export** → a reviewed commit in `ai/profiles/`.

- **`STUDIO_SEED_DIR`** names a directory in the seed's layout: `config/studio/workflows/*.json`, `config/prompting.json`, `config/lora-catalogue.json` and `config/models.json` (an unpacked export has the same layout). It is read-only and optional. At each start Studio copies only what is missing: a profile file it has never held (one removed in Studio is not brought back) and a `config/` file the data folder lacks. Nothing Studio holds is overwritten. Without the variable nothing is copied.
- **Guides' seed:** `MCP_PROMPTING_PATH`, else (with `STUDIO_SEED_DIR`) the data folder's `config/prompting.json`. It fills a new install and adds missing packs only.
- **Export** (`GET /api/profiles/export`, administrators) is a zip in the seed's layout: every profile file exactly as on disk, `config/prompting.json` (the guide store without `meta`), `config/lora-catalogue.json` (the LoRA catalogue by file name, with Studio's edits), `config/models.json` (the restore manifest, when there is one) and `EXPORT.json`, which lists each profile's and guide's version, origin and AI-Drafted state, what changed since the last export, and the AI drafts nobody has approved yet.
- **AI drafts:** a checkpoint or diffusion model imported in the Library drafts a profile from the nearest same-family profile and the page's recommended settings, and a guide from the page. It is checked against ComfyUI's `object_info` before it is written (nothing is activated while ComfyUI can't be asked, or when it doesn't know a node type), marked NSFW unless the source says otherwise, and the parts it needs (VAE, text encoders) join the import's files for Download Missing. It is **AI-Drafted**: live for administrators only, and hidden from every other account (even with an explicit grant) until an administrator approves it or edits it in Settings › Profiles.

## Hidden Removal

Studio no longer has Hidden. The first start of a version without it backs up and converts what an older Hidden left in the data folder, once, and deletes nothing:

- **The backup** goes to `<STUDIO_DATA_DIR>/backups/hidden-removal-<time>/` (readable by the server's user only). It holds copies of `gallery.json`, `gallery-hidden.json`, `privacy.json` and `hidden-runs.json` where they existed, the encrypted `.private-vault` folder moved in whole, and a `summary.json` and `README.txt` saying what changed. The backup is written even on a studio that never used Hidden, so a deployment can confirm the step ran.
- **Into the gallery:** gallery records still flagged as Hidden become ordinary gallery items, and records that a delete marker in `gallery-hidden.json` kept out of view come back. Markers for deleted and cleared outputs stay, so those don't return from ComfyUI's history.
- **Still encrypted:** images inside the vault can't be opened without the owner's Hidden password, so they stay as ciphertext in the backup. `summary.json` counts them, and the server log warns once. Prompts sealed by the older scheme are cleared from the gallery records; the backup's copy of `gallery.json` keeps them.

`<STUDIO_DATA_DIR>/.hidden-removed-v1` records that the step finished. Remove it only to run the step again.

## Renamed Settings

Studio became a hard fork of HEISS UI and renamed its `HEISS_*` settings to `STUDIO_*`. The old names still work as deprecated aliases: Studio reads the new name first and falls back to the old one, and the log gets one line naming the old ones still in use. Saving a setting from Settings writes the new name to Studio's settings file and drops the old line. Compose also still reads `HEISS_DOCKER_COMFY_URL` when `STUDIO_DOCKER_COMFY_URL` is unset. Rename them in your deployment when convenient; a later release removes the aliases.

| Old | New |
| --- | --- |
| `HEISS_ALLOW_LAN` | `STUDIO_ALLOW_LAN` |
| `HEISS_ALLOWED_HOSTS` | `STUDIO_ALLOWED_HOSTS` |
| `HEISS_COMFY_LOST_AFTER_MS` | `STUDIO_COMFY_LOST_AFTER_MS` |
| `HEISS_COMFY_ROOT` | `STUDIO_COMFY_ROOT` |
| `HEISS_COMFY_SEARCH` | `STUDIO_COMFY_SEARCH` |
| `HEISS_DATA_DIR` | `STUDIO_DATA_DIR` |
| `HEISS_DEFAULT_COMFY_URL` | `STUDIO_DEFAULT_COMFY_URL` |
| `HEISS_DEMO` | `STUDIO_DEMO` |
| `HEISS_DEV_PROXY_TOKEN` | `STUDIO_DEV_PROXY_TOKEN` |
| `HEISS_DEVICE_SESSION_DAYS` | `STUDIO_DEVICE_SESSION_DAYS` |
| `HEISS_DOCKER_HOST_ONLY` | `STUDIO_DOCKER_HOST_ONLY` |
| `HEISS_ENABLE_INPAINT` | `STUDIO_ENABLE_INPAINT` |
| `HEISS_ENV_FILE` | `STUDIO_ENV_FILE` |
| `HEISS_FFMPEG_PATH` | `STUDIO_FFMPEG_PATH` |
| `HEISS_GALLERY_CHANGELOG_LIMIT` | `STUDIO_GALLERY_CHANGELOG_LIMIT` |
| `HEISS_GALLERY_LIMIT` | `STUDIO_GALLERY_LIMIT` |
| `HEISS_GALLERY_SAVE_MS` | `STUDIO_GALLERY_SAVE_MS` |
| `HEISS_HTTPS_PORT` | `STUDIO_HTTPS_PORT` |
| `HEISS_LAN` | `STUDIO_LAN` |
| `HEISS_PREVIEW_INTERVAL_MS` | `STUDIO_PREVIEW_INTERVAL_MS` |
| `HEISS_REFERENCE_MAX_BYTES` | `STUDIO_REFERENCE_MAX_BYTES` |
| `HEISS_REFERENCE_MAX_PIXELS` | `STUDIO_REFERENCE_MAX_PIXELS` |
| `HEISS_SEEDVR2_HF_REPO` | `STUDIO_SEEDVR2_HF_REPO` |
| `HEISS_SEEDVR2_MODEL_DIR` | `STUDIO_SEEDVR2_MODEL_DIR` |
| `HEISS_TERMINAL_JOB_TTL_MS` | `STUDIO_TERMINAL_JOB_TTL_MS` |
| `HEISS_THUMBNAIL_CACHE_MB` | `STUDIO_THUMBNAIL_CACHE_MB` |
| `HEISS_TLS_CERT` | `STUDIO_TLS_CERT` |
| `HEISS_TLS_KEY` | `STUDIO_TLS_KEY` |
| `HEISS_TRASH_DAYS` | `STUDIO_TRASH_DAYS` |
| `HEISS_VIDEO_PREVIEW_CACHE_MB` | `STUDIO_VIDEO_PREVIEW_CACHE_MB` |

The same goes for the names browsers and scripts see. Studio writes only the new ones and reads the old ones until a later release:

| What | Old | New | Compatibility |
| --- | --- | --- | --- |
| Request header for changes from scripts | `X-HEISS` | `X-Studio` | Both accepted |
| Sign-in needed (401 response) | `X-HEISS-Sign-In` | `X-Studio-Sign-In` | The page reads both |
| Device sign-in cookie (single-user LAN mode) | `heiss_device` | `studio_device` | The old cookie still signs in and is moved to the new name on the next request |
| Browser storage (preferences, drafts, LoRA favourites and the rest) | `heiss-ui-*`, `heiss-ui:*`, `heiss.*`, `heiss-grid-autoplay` | `studio-*`, `studio:*`, `studio.*`, `studio-grid-autoplay` | Moved to the new names when the page starts |

Accounts already use `studio_account`, so account sessions are unaffected.

## On-Disk Names

Some names on disk still come from HEISS UI. Gallery records, account media and ComfyUI's output folder hold these paths, so Studio keeps writing them and never moves or renames files by itself. It already recognises the Studio name beside each one (`server/data-names.js`), so files a migration has moved keep working.

| Kept name | Where | Studio name it also reads |
| --- | --- | --- |
| `heiss-ui/` (and `heiss-ui/accounts/<hash>/`) | ComfyUI's output folder and `STUDIO_MEDIA_DIR` (for example `/data/media/heiss-ui`) | `studio/` |
| `.heiss-trash/` | Beside trashed files in the output and media folders | `.studio-trash/` (skipped by snapshots) |
| `heiss_generation` | Run records in ComfyUI's queue and history | `studio_generation` (written now) |
| `heissUi` | The mapping block in workflow and profile files (`/data/workflows`, the `ai/profiles/` seed) | `studio` (read; Studio still writes `heissUi`) |
| `heiss_*` sections, `.heiss-backup` | ComfyUI's `extra_model_paths.yaml` (single-user mode) | Not renamed |
| `heiss` text chunk | Metadata in PNGs Studio wrote | Not renamed |
| `heiss-ui-reference-*`, `heiss-ui-upscale-*` | File names in ComfyUI's input folder | Not renamed |

Logs are now `studio-YYYY-MM-DD.log`; older `heiss-*.log` files are still pruned after a week.

### Moving to Studio Names Later

A later release adds an explicit migration command. It is never run automatically. Until then, nothing needs to change.

1. **Back up.** Stop Studio (scale it to zero), then snapshot the data volume (`/data`, on kimbap's `truenas-nvme/studio` dataset) and, with ComfyUI's output folder, that folder too. Keep the snapshots until the migrated studio has run for a while.
2. **Dry run (default).** The command lists every mapping it would apply and changes nothing:
   - folders: `<media>/heiss-ui` → `<media>/studio`, `<output>/heiss-ui` → `<output>/studio`, and each `.heiss-trash` → `.studio-trash`
   - records: each gallery, history, trash and comparison record whose `subfolder` or `/media`, `/comfy/view` and thumbnail URL starts with `heiss-ui/` (counted per account)
   - refusals: a target folder that already exists and differs, a record that points at a missing file, or a running Studio.
3. **Apply (`--apply`).** It writes a mapping manifest first (every old → new path and record ID), renames the folders (a rename on the same file system, so no copy), rewrites the records, verifies the record and file counts against the dry run, and writes a marker so a second run does nothing.
4. **Switch.** The release that ships the command changes `outputFolderName` and `trashFolderName` in `server/data-names.js` to the Studio names; the old names stay readable for one more release.
5. **Recovery.** `--undo <manifest>` renames the folders back and restores the records from the backups the apply step made. If anything else is wrong, restore the snapshots from step 1 and redeploy the previous image.

The profile block is a file format shared with the `ai/profiles/` seed. Studio reads both `studio` and `heissUi` (a file with both is refused by the profile check), and keeps writing `heissUi` (`writtenBlockName` in `server/profile-block.js`) until the seed and its checks are migrated to `studio`; that switch is its own change.
