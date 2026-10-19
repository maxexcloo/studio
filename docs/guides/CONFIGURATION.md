# Configuration

Copy `.env.example` to `.env` when you need different ports or paths.

Set `HEISS_ENABLE_BUILTIN_PROFILES=0` to use only imported workflows. This hides detected model profiles and bundled workflow templates from the generation catalogue; their definitions and model files remain intact. Built-in profiles are enabled by default.

```bash
COMFY_URL=http://127.0.0.1:8188
HOST=127.0.0.1
PORT=8787
HEISS_DATA_DIR=./data
COMFY_OUTPUT_DIR=
```

`COMFY_OUTPUT_DIR` is optional; the folder is usually found without it. The folder is needed to delete files along with their cards and to remove ComfyUI's copies of what goes into Hidden. Settings only accepts a folder ComfyUI writes to (one with ComfyUI's images, or next to its `models` or `custom_nodes`). **Delete all finished images** moves them to `.heiss-trash` in that folder, where they wait 30 days (`HEISS_TRASH_DAYS`) in case you want them back.

For other devices: `HEISS_ALLOWED_HOSTS` (extra names to answer to, comma-separated), `HEISS_DEVICE_SESSION_DAYS` (how long a device stays signed in, 1 to 30 days, 7 by default), and `HEISS_TLS_CERT`, `HEISS_TLS_KEY` and `HEISS_HTTPS_PORT` for HTTPS. See [Connect over LAN](#connect-over-lan), [On your phone](#on-your-phone) and [SECURITY.md](./SECURITY.md).

`COMFY_VIDEO_URL` optionally routes local video workflows to a second ComfyUI endpoint. Images and provider-backed Grok workflows continue to use `COMFY_URL`; if the video endpoint is unavailable, video work does not fall back to the image server. Both backends must share input and output storage for local gallery access.

## Model Manifest

`HEISS_MODEL_MANIFEST` points at a pinned list of the models a deployment expects: a JSON array of `{ "path", "sha256", "size", "url"? }` entries. Each `path` is relative to ComfyUI's model folder; when the manifest's paths start with a deployment folder instead (such as `models/comfyui/`), set `HEISS_MODEL_MANIFEST_PREFIX` to strip it.

**Settings › Models › Model Manifest** shows which files are verified, present, missing or wrong. It verifies checksums in the background, and restores missing files through HEISS's checksum-verifying downloader. Only Civitai and Hugging Face files that go straight into a model folder are restored; others are listed with the reason, for the deployment's own tooling.

An administrator can import another manifest or export the one in use. The deployment's file stays the disaster-recovery record.

## HEISS Media Storage (ComfyUI as a Worker)

With media storage, HEISS keeps every finished output in its own folder and treats ComfyUI as a stateless worker:

- HEISS fetches each output over ComfyUI's HTTP API into `HEISS_MEDIA_DIR` (`<HEISS_DATA_DIR>/media` by default), with a folder per account.
- The [HEISS worker node](../../comfyui/heiss_worker/README.md) then removes ComfyUI's copy, the run's staged inputs and its history entry.
- HEISS and ComfyUI no longer need to share a folder, so they can run on different servers.

Media storage is on by default in multi-user mode. `HEISS_OUTPUT_STORAGE=heiss` turns it on for a single-user studio, and `HEISS_OUTPUT_STORAGE=comfy` keeps ComfyUI's output folder. Set the same `HEISS_WORKER_TOKEN` in HEISS and ComfyUI to protect the worker node's endpoints.

Existing ComfyUI outputs stay where they are; only new runs, upscales and recovered runs move. If an output cannot be fetched, it keeps its ComfyUI address instead of being lost. Without the worker node, ComfyUI keeps its copies and HEISS logs a warning.

## Multi-User Mode

`HEISS_MULTI_USER=1` turns on optional accounts. It is off by default; single-user mode and device sign-in behave as before.

- **Every request needs an account,** including requests from this computer. The first visit on the computer running HEISS UI creates the recovery administrator; after that, administrators add accounts in **Settings › Accounts & MCP**. Where nobody can open HEISS on its own computer (a container platform), set `HEISS_SETUP_TOKEN` to a random value of at least 32 characters: the first-administrator screen then accepts it from any address, until an account exists.
- **Single sign-on (Pocket ID or another OpenID Connect provider):** set `HEISS_OIDC_ISSUER`, `HEISS_OIDC_CLIENT_ID` and `HEISS_OIDC_REDIRECT_URI` (`https://<studio>/api/accounts/oidc/callback`). Public PKCE clients need no secret; `HEISS_OIDC_CLIENT_SECRET` supports confidential clients, and `HEISS_OIDC_LABEL` names the button. The provider only proves identity. A verified email that matches an account's username links that account. Any other identity becomes a pending account, which an administrator approves by assigning an access profile. Roles never come from the provider.
- **Probes stay open:** `/api/ping` (liveness) and `/api/ready` (readiness: the data folder is writable) answer without an account. ComfyUI workers being down does not make HEISS unready.
- **Administrators** have full access. **Ordinary accounts** get one access profile, which lists the generation profiles they may use and switches for galleries, prompt history, LoRAs, references and image/video generation. New generation profiles stay administrator-only until a profile grants them.
- **Each account's outputs, prompt history, LoRA stacks, references and jobs are private** and saved under its own output subfolder. Ordinary accounts only reach reviewed, owner-checked routes; studio administration (models, library folders, Hidden, connection, updates, presets, trash) stays with administrators. Hidden and run grouping are unavailable to accounts.
- **Personal MCP tokens** are issued once in Settings, stored only as hashes, and work only for MCP. They are never an administrator credential. Rotating or revoking a token leaves existing result links working; a result link ends when its output is hidden or deleted.
- **Records from single-user mode have no owner** and stay out of every account's gallery until they are explicitly migrated to an account.

`HEISS_ACCOUNT_MAX_OUTSTANDING_JOBS` limits each ordinary account's queued and running generations (2 by default). Session cookies are marked `Secure` over HTTPS, including behind a proxy that sends `X-Forwarded-Proto: https`.

### Importing an Existing Studio

`scripts/import-studio.mjs` moves a whole single-user studio into one existing account of this studio. It runs against this studio's `HEISS_DATA_DIR` and `HEISS_MEDIA_DIR`; stop HEISS first.

```bash
node scripts/import-studio.mjs --source-data /old/heiss/data --source-outputs /old/comfy/output --account studio --label normal         # dry run
node scripts/import-studio.mjs --source-data /old/heiss/data --source-outputs /old/comfy/output --account studio --label normal --apply
node scripts/import-studio.mjs --undo <batch>
```

- **What moves:** finished gallery outputs and their upscales (copied into the account's media folder), prompt and negative-prompt history, LoRA stacks and library, uploaded references, and MCP job and reference ownership.
- **What doesn't:** Hidden (it is encrypted and unavailable to accounts), presets and workflow preferences (studio-wide), pending or failed records, and library-folder items. Each of these is counted in the dry run.
- **Without `--apply`,** nothing is written; the dry run lists every count and conflict.
- **The source is never changed.** Every target file that changes is backed up under `<HEISS_DATA_DIR>/imports/<batch>/`, and `--undo` removes exactly what that import added.
- **Refused:** an import whose jobs are already in the gallery, an account that already has its own history files, or a result above `HEISS_GALLERY_LIMIT`.

MCP clients connect in one of three ways in multi-user mode:

- **Personal token:** a client sends the account's own token.
- **Trusted gateway:** a chat gateway such as LiteLLM sends the shared `HEISS_MCP_API_KEY` together with its own user ID in `x-ai-user-id`. HEISS acts for that user only after an administrator links the ID to an account under **Settings › Accounts & MCP › Chat Gateway Users**. Unlinked IDs are refused and listed there for linking.
- **AI Control:** `CONTROL_MCP_API_KEY` keeps its control tools and reaches no galleries or accounts.

MCP's own requests to the studio use a per-process internal credential. It is accepted only from this computer and only for MCP's routes.

`Status` and `Result` wait at most 20 seconds for a job, so a chat model that waits in the foreground cannot block its chat. A `Result` with `delivery=notification`, which hosts run in the background, waits up to 1500 seconds, below LibreChat's 1800-second background deadline. MCP keeps each account's model list for up to a minute; rescanning models in the studio refreshes it at once.

`HEISS_ENABLE_GROK=0`, `HEISS_ENABLE_TESSERA=0` and `HEISS_ENABLE_LORAS=0` disable those optional catalogue features and reject unavailable generation settings. All three are enabled by default.

`HEISS_DEFAULT_IMAGE_PROFILE` and `HEISS_DEFAULT_VIDEO_PROFILE` optionally select the instance’s default ready workflow IDs. They apply to a fresh composer and mode changes; existing drafts remain intact. Missing or unavailable IDs fall back to the first ready profile. Reference-image variants run separately to limit GPU memory. Image workflows apply their batch count when selected; fresh image preferences default to one, while video and workflows without batch support use one.

Also optional: `HEISS_COMFY_SEARCH=0` keeps HEISS on `COMFY_URL` (the **Find ComfyUI on its own** switch under Settings › Connection › Change address; by default, when that doesn't answer, HEISS looks on 8188 and 8000 and switches to whatever ComfyUI answers there), and `HEISS_THUMBNAIL_CACHE_MB` caps the gallery's thumbnail cache (2048 by default; the least recently shown go first).

Model downloads follow the Hugging Face tools' own settings. `HF_TOKEN` (or a token saved in **Settings › Models**) opens gated repos and is only sent to huggingface.co, `HF_ENDPOINT` points downloads at a mirror, and `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` send them through a proxy.

## Civitai Images & Downloads

Image & Model Library is disabled by default. Set `HEISS_ENABLE_PRESETS=1` only on the secondary instance; keep it unset or `0` on the primary instance. The server enforces this switch for preset data, thumbnails, imports, provider downloads and Civitai token settings, and the desktop and phone controls follow the server’s feature flag. Existing catalogue downloads remain available independently.

Open **Image & Model Library** from the desktop toolbar or phone gallery. **Images** accepts a Civitai image link and downloads the full image into this studio’s gallery with its prompt, generation settings, checkpoint and LoRA associations. Missing supported resources queue automatically through the configured downloader; filename conflicts and unavailable resources remain explicit. Existing saved presets migrate to gallery images when the library opens. Imported images use the normal viewer, settings reuse, reference selection, Hidden and deletion behaviour. Deleting an image keeps downloaded models.

**Use Settings** applies the image’s recipe to its installed image workflow without starting a generation. Exact resource matches use SHA-256, including renamed files. Missing LoRAs, unknown weights and unsupported resource types require attention; **Use Prompt Only** is available independently. Civitai metadata is optional, and additional processing such as ControlNet, high-resolution passes and CLIP skip needs a matching workflow. Imported settings cannot guarantee an identical image.

**Models** accepts Civitai model links (including `modelVersionId`) and Hugging Face links to individual SafeTensors or GGUF files. Local downloads use the existing resumable queue and check published SHA-256 values. Hugging Face revisions are pinned to a commit when previewed. A filename conflict is never resolved by replacing the existing file automatically.

Public imports do not require a token. Set `CIVITAI_API_TOKEN` in the server environment for resources your account can access. Tokens are kept on the server and are never returned to the browser or forwarded to the image/file CDN. Imports, image deletion and model downloads are available at the server or from a signed-in device. Provider credential changes retain the existing admin boundary; the library does not expose credential controls.

For a read-only shared library managed by AI Control, configure `HEISS_MODEL_DOWNLOAD_URL` with its reachable API base URL, including `/api`, and `HEISS_MODEL_DOWNLOAD_TOKEN` with its API credential through the existing secret configuration. Derive the address and scheme from the AI Control deployment rather than copying another host’s endpoint. HEISS calls the existing `downloads` and `jobs/{id}` endpoints; it does not require changes to AI Control. This service uses its own provider credentials and download verification. Downloads continue while the dialog is closed. HEISS keeps delegated queue tracking for the current server session; a HEISS restart loses that tracking, while a job already accepted by AI Control continues there.

Shared downloads do not change Normal access, mount permissions or GPU allocation. Select newly downloaded files in AI Control before using them in Normal, then use **Check Again** in HEISS. The settings above only configure the connection; they do not deploy or restart either service.
