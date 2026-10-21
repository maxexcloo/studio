# Configuration

Copy `.env.example` to `.env` when you need different ports or paths.

Set `STUDIO_ENABLE_BUILTIN_PROFILES=0` to use only imported workflows. This hides detected model profiles and bundled workflow templates from the generation catalogue; their definitions and model files remain intact. Built-in profiles are enabled by default.

```bash
COMFY_URL=http://127.0.0.1:8188
HOST=127.0.0.1
PORT=8787
HEISS_DATA_DIR=./data
COMFY_OUTPUT_DIR=
```

`COMFY_OUTPUT_DIR` is optional; the folder is usually found without it. The folder is needed to delete files along with their cards. Settings only accepts a folder ComfyUI writes to (one with ComfyUI's images, or next to its `models` or `custom_nodes`). **Delete all finished images** moves them to `.heiss-trash` in that folder, where they wait 30 days (`HEISS_TRASH_DAYS`) in case you want them back.

For other devices: `HEISS_ALLOWED_HOSTS` (extra names to answer to, comma-separated), `HEISS_DEVICE_SESSION_DAYS` (how long a device stays signed in, 1 to 30 days, 7 by default), and `HEISS_TLS_CERT`, `HEISS_TLS_KEY` and `HEISS_HTTPS_PORT` for HTTPS. See [Other devices](./SECURITY.md#other-devices-signing-in-admin-https-and-proxies) and [Phones and other devices](./TROUBLESHOOTING.md#phones-and-other-devices).

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

- Studio fetches each output over ComfyUI's HTTP API into `STUDIO_MEDIA_DIR` (`<HEISS_DATA_DIR>/media` by default), with a folder per account.
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

`scripts/import-studio.mjs` moves a whole single-user studio into one existing account of this studio. It runs against this studio's `HEISS_DATA_DIR` and `STUDIO_MEDIA_DIR`; stop Studio first.

```bash
node scripts/import-studio.mjs --source-data /old/heiss/data --source-outputs /old/comfy/output --account studio --label normal         # dry run
node scripts/import-studio.mjs --source-data /old/heiss/data --source-outputs /old/comfy/output --account studio --label normal --apply
node scripts/import-studio.mjs --undo <batch>
```

- **What moves:** finished gallery outputs and their upscales (copied into the account's media folder), prompt and negative-prompt history, LoRA stacks and library, uploaded references, and MCP job and reference ownership.
- **What doesn't:** Hidden items from an older studio (they are encrypted), presets and workflow preferences (studio-wide), pending or failed records, and library-folder items. Each of these is counted in the dry run.
- **Without `--apply`,** nothing is written; the dry run lists every count and conflict.
- **The source is never changed.** Every target file that changes is backed up under `<HEISS_DATA_DIR>/imports/<batch>/`, and `--undo` removes exactly what that import added.
- **Refused:** an import whose jobs are already in the gallery, an account that already has its own history files, or a result above `HEISS_GALLERY_LIMIT`.

MCP clients connect in one of three ways in multi-user mode:

- **Personal token:** a client sends the account's own token.
- **Trusted gateway:** a chat gateway such as LiteLLM sends the shared `STUDIO_MCP_API_KEY` together with its own user ID in `x-ai-user-id`. Studio acts for that user only once the ID is linked to an account. When the gateway also forwards the user's email in `x-ai-user-email` and it matches an enabled, approved account's username (ignoring case), Studio links the ID to that account on its first request, recorded like an administrator's link; it never creates accounts this way. Otherwise an administrator links the ID under **Settings › Users › Chat Gateway Users**, where unlinked IDs are listed; **Dismiss** removes one from the list until the gateway sends it again. Unlinked IDs still see the tools, but every call only returns a message asking for the link, so the chat explains the problem instead of reporting no tools. Unlinking an ID whose email matches an enabled account lets it link again on its next request; disable the account to stop it.
- **AI Control:** `CONTROL_MCP_API_KEY` keeps its control tools and reaches no galleries or accounts. They need `CONTROL_URL` and `CONTROL_API_KEY`; nothing else in Studio uses AI Control, which has no panel in Settings.

MCP's own requests to the studio use a per-process internal credential. It is accepted only from this computer and only for MCP's routes.

`Status` and `Result` wait at most 20 seconds for a job, so a chat model that waits in the foreground cannot block its chat. A `Result` with `delivery=notification`, which hosts run in the background, waits up to 1500 seconds, below LibreChat's 1800-second background deadline. MCP keeps each account's model list for up to a minute; rescanning models in the studio refreshes it at once.

`STUDIO_ENABLE_GROK=0`, `STUDIO_ENABLE_TESSERA=0` and `STUDIO_ENABLE_LORAS=0` disable those optional catalogue features for everyone, administrators included, and reject unavailable generation settings; the matching access-profile options show as locked. All three are enabled by default and Settings no longer switches them. In account mode, a LoRAs or Cloud Models value saved earlier from Settings is carried into every access profile once (a profile keeps a feature only where the switch had it on) and then dropped from Studio's own env file.

`STUDIO_DEFAULT_IMAGE_PROFILE` and `STUDIO_DEFAULT_VIDEO_PROFILE` optionally select the instance’s default ready workflow IDs. They apply to a fresh composer and mode changes; existing drafts remain intact. Missing or unavailable IDs fall back to the first ready profile. Reference-image variants run separately to limit GPU memory. Image workflows apply their batch count when selected; fresh image preferences default to one, while video and workflows without batch support use one.

Also optional: `HEISS_COMFY_SEARCH=0` keeps Studio on the default worker's address (by default, when that doesn't answer, Studio looks on 8188 and 8000 and switches to whatever ComfyUI answers there), and `HEISS_THUMBNAIL_CACHE_MB` caps the gallery's thumbnail cache (2048 by default; the least recently shown go first).

Model downloads follow the Hugging Face tools' own settings. `HF_TOKEN` (or a token saved in **Settings › Models**) opens gated repos and is only sent to huggingface.co, `HF_ENDPOINT` points downloads at a mirror, and `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` send them through a proxy.

## Civitai Images & Downloads

Image & Model Library is disabled by default. Set `STUDIO_ENABLE_PRESETS=1` only on instances that should offer it; keep it unset or `0` everywhere else. The server enforces this switch for preset data, thumbnails, imports, provider downloads and Civitai token settings, and the desktop and phone controls follow the server’s feature flag. Existing catalogue downloads remain available independently.

Open **Image & Model Library** from the desktop toolbar or phone gallery. **Images** accepts a Civitai image link and downloads the full image into this studio’s gallery with its prompt, generation settings, checkpoint and LoRA associations. Missing supported resources queue automatically through the configured downloader; filename conflicts and unavailable resources remain explicit. Existing saved presets migrate to gallery images when the library opens. Imported images use the normal viewer, settings reuse, reference selection and deletion behaviour. Deleting an image keeps downloaded models.

**Use Settings** applies the image’s recipe to its installed image workflow without starting a generation. Exact resource matches use SHA-256, including renamed files. Missing LoRAs, unknown weights and unsupported resource types require attention; **Use Prompt** is available independently. Civitai metadata is optional, and additional processing such as ControlNet, high-resolution passes and CLIP skip needs a matching workflow. Imported settings cannot guarantee an identical image.

**Models** accepts Civitai model links (including `modelVersionId`) and Hugging Face links to individual SafeTensors or GGUF files. Local downloads use the existing resumable queue and check published SHA-256 values. Hugging Face revisions are pinned to a commit when previewed. A filename conflict is never resolved by replacing the existing file automatically.

Public imports do not require a token. Set `CIVITAI_API_TOKEN` in the server environment for resources your account can access. Tokens are kept on the server and are never returned to the browser or forwarded to the image/file CDN. Imports, image deletion and model downloads are available at the server or from a signed-in device. Provider credential changes retain the existing admin boundary; the library does not expose credential controls.

## Hidden Removal

Studio no longer has Hidden. The first start of a version without it backs up and converts what an older Hidden left in the data folder, once, and deletes nothing:

- **The backup** goes to `<HEISS_DATA_DIR>/backups/hidden-removal-<time>/` (readable by the server's user only). It holds copies of `gallery.json`, `gallery-hidden.json`, `privacy.json` and `hidden-runs.json` where they existed, the encrypted `.private-vault` folder moved in whole, and a `summary.json` and `README.txt` saying what changed. The backup is written even on a studio that never used Hidden, so a deployment can confirm the step ran.
- **Into the gallery:** gallery records still flagged as Hidden become ordinary gallery items, and records that a delete marker in `gallery-hidden.json` kept out of view come back. Markers for deleted and cleared outputs stay, so those don't return from ComfyUI's history.
- **Still encrypted:** images inside the vault can't be opened without the owner's Hidden password, so they stay as ciphertext in the backup. `summary.json` counts them, and the server log warns once. Prompts sealed by the older scheme are cleared from the gallery records; the backup's copy of `gallery.json` keeps them.

`<HEISS_DATA_DIR>/.hidden-removed-v1` records that the step finished. Remove it only to run the step again.
