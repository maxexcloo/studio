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

`COMFY_OUTPUT_DIR` is optional; the folder is usually found without it. The folder is needed to delete files along with their cards and to remove ComfyUI's copies of what goes into Hidden. Settings only accepts a folder ComfyUI writes to (one with ComfyUI's images, or next to its `models` or `custom_nodes`). **Delete all finished images** moves them to `.heiss-trash` in that folder, where they wait 30 days (`HEISS_TRASH_DAYS`) in case you want them back.

For other devices: `HEISS_ALLOWED_HOSTS` (extra names to answer to, comma-separated), `HEISS_DEVICE_SESSION_DAYS` (how long a device stays signed in, 1 to 30 days, 7 by default), and `HEISS_TLS_CERT`, `HEISS_TLS_KEY` and `HEISS_HTTPS_PORT` for HTTPS. See [Other devices](./SECURITY.md#other-devices-signing-in-admin-https-and-proxies) and [Phones and other devices](./TROUBLESHOOTING.md#phones-and-other-devices).

`COMFY_VIDEO_URL` optionally routes local video workflows to a second ComfyUI endpoint. Images and provider-backed Grok workflows continue to use `COMFY_URL`; if the video endpoint is unavailable, video work does not fall back to the image server. With [Studio media storage](#studio-media-storage-comfyui-as-a-worker) the backends need no shared storage; with ComfyUI's output folder, both must share input and output storage for local gallery access.

## Model Manifest

`STUDIO_MODEL_MANIFEST` points at a pinned list of the models a deployment expects: a JSON array of `{ "path", "sha256", "size", "url"? }` entries. Each `path` is relative to ComfyUI's model folder; when the manifest's paths start with a deployment folder instead (such as `models/comfyui/`), set `STUDIO_MODEL_MANIFEST_PREFIX` to strip it.

**Settings › Models › Model Manifest** shows which files are verified, present, missing or wrong. It verifies checksums in the background, and restores missing files through Studio's checksum-verifying downloader. Only Civitai and Hugging Face files that go straight into a model folder are restored; others are listed with the reason, for the deployment's own tooling.

An administrator can import another manifest or export the one in use. The deployment's file stays the disaster-recovery record.

## Studio Media Storage (ComfyUI as a Worker)

With media storage, Studio keeps every finished output in its own folder and treats ComfyUI as a stateless worker:

- Studio fetches each output over ComfyUI's HTTP API into `STUDIO_MEDIA_DIR` (`<HEISS_DATA_DIR>/media` by default), with a folder per account.
- The [Studio worker node](../../comfyui/studio_worker/README.md) then removes ComfyUI's copy, the run's staged inputs and its history entry.
- Studio and ComfyUI no longer need to share a folder, so they can run on different servers.

Media storage is on by default in multi-user mode. `STUDIO_OUTPUT_STORAGE=studio` turns it on for a single-user studio, and `STUDIO_OUTPUT_STORAGE=comfy` keeps ComfyUI's output folder. Set the same `STUDIO_WORKER_TOKEN` in Studio and ComfyUI to protect the worker node's endpoints.

Existing ComfyUI outputs stay where they are; only new runs, upscales and recovered runs move. If an output cannot be fetched, it keeps its ComfyUI address instead of being lost. Without the worker node, ComfyUI keeps its copies and Studio logs a warning.

## Multi-User Mode

`STUDIO_MULTI_USER=1` turns on optional accounts. It is off by default; single-user mode and device sign-in behave as before.

- **Every request needs an account,** including requests from this computer. The first visit on the computer running Studio creates the recovery administrator; after that, administrators add accounts in **Settings › Accounts & MCP**. Accounts sign in with their email address, which is the account's username; accounts created before this with other usernames keep signing in with them. Where nobody can open Studio on its own computer (a container platform), set `STUDIO_SETUP_TOKEN` to a random value of at least 32 characters: the first-administrator screen then accepts it from any address, until an account exists.
- **Single sign-on (Pocket ID or another OpenID Connect provider):** set `STUDIO_OIDC_ISSUER`, `STUDIO_OIDC_CLIENT_ID` and `STUDIO_OIDC_REDIRECT_URI` (`https://<studio>/api/accounts/oidc/callback`). Public PKCE clients need no secret; `STUDIO_OIDC_CLIENT_SECRET` supports confidential clients, and `STUDIO_OIDC_LABEL` names the button. The provider only proves identity. A verified email that matches an account's username links that account. Any other identity becomes a pending account, which an administrator approves by assigning an access profile. Roles never come from the provider.
- **Probes stay open:** `/api/ping` (liveness) and `/api/ready` (readiness: the data folder is writable) answer without an account. ComfyUI workers being down does not make Studio unready.
- **Administrators** have full access. **Ordinary accounts** get one access profile, which lists the generation profiles they may use and switches for galleries, prompt history, LoRAs, references and image/video generation. New generation profiles stay administrator-only until a profile grants them.
- **Each account's outputs, prompt history, LoRA stacks, references and jobs are private** and saved under its own output subfolder. Ordinary accounts only reach reviewed, owner-checked routes; studio administration (models, library folders, Hidden, connection, updates, presets, trash) stays with administrators. Hidden and run grouping are unavailable to accounts.
- **Personal MCP tokens** are issued once in Settings, stored only as hashes, and work only for MCP. They are never an administrator credential. Rotating or revoking a token leaves existing result links working; a result link ends when its output is hidden or deleted.
- **Records from single-user mode have no owner** and stay out of every account's gallery until they are explicitly migrated to an account.

`STUDIO_ACCOUNT_MAX_OUTSTANDING_JOBS` limits each ordinary account's queued and running generations (2 by default). Session cookies are marked `Secure` over HTTPS, including behind a proxy that sends `X-Forwarded-Proto: https`.

### Importing an Existing Studio

`scripts/import-studio.mjs` moves a whole single-user studio into one existing account of this studio. It runs against this studio's `HEISS_DATA_DIR` and `STUDIO_MEDIA_DIR`; stop Studio first.

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
- **Trusted gateway:** a chat gateway such as LiteLLM sends the shared `STUDIO_MCP_API_KEY` together with its own user ID in `x-ai-user-id`. Studio acts for that user only once the ID is linked to an account. When the gateway also forwards the user's email in `x-ai-user-email` and it matches an enabled, approved account's username (ignoring case), Studio links the ID to that account on its first request, recorded like an administrator's link; it never creates accounts this way. Otherwise an administrator links the ID under **Settings › Accounts & MCP › Chat Gateway Users**, where unlinked IDs are listed; **Dismiss** removes one from the list until the gateway sends it again. Unlinked IDs still see the tools, but every call only returns a message asking for the link, so the chat explains the problem instead of reporting no tools. Unlinking an ID whose email matches an enabled account lets it link again on its next request; disable the account to stop it.
- **AI Control:** `CONTROL_MCP_API_KEY` keeps its control tools and reaches no galleries or accounts.

MCP's own requests to the studio use a per-process internal credential. It is accepted only from this computer and only for MCP's routes.

`Status` and `Result` wait at most 20 seconds for a job, so a chat model that waits in the foreground cannot block its chat. A `Result` with `delivery=notification`, which hosts run in the background, waits up to 1500 seconds, below LibreChat's 1800-second background deadline. MCP keeps each account's model list for up to a minute; rescanning models in the studio refreshes it at once.

`STUDIO_ENABLE_GROK=0`, `STUDIO_ENABLE_TESSERA=0` and `STUDIO_ENABLE_LORAS=0` disable those optional catalogue features and reject unavailable generation settings. All three are enabled by default.

`STUDIO_DEFAULT_IMAGE_PROFILE` and `STUDIO_DEFAULT_VIDEO_PROFILE` optionally select the instance’s default ready workflow IDs. They apply to a fresh composer and mode changes; existing drafts remain intact. Missing or unavailable IDs fall back to the first ready profile. Reference-image variants run separately to limit GPU memory. Image workflows apply their batch count when selected; fresh image preferences default to one, while video and workflows without batch support use one.

Also optional: `HEISS_COMFY_SEARCH=0` keeps Studio on `COMFY_URL` (the **Find ComfyUI on its own** switch under Settings › Connection › Change address; by default, when that doesn't answer, Studio looks on 8188 and 8000 and switches to whatever ComfyUI answers there), and `HEISS_THUMBNAIL_CACHE_MB` caps the gallery's thumbnail cache (2048 by default; the least recently shown go first).

Model downloads follow the Hugging Face tools' own settings. `HF_TOKEN` (or a token saved in **Settings › Models**) opens gated repos and is only sent to huggingface.co, `HF_ENDPOINT` points downloads at a mirror, and `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` send them through a proxy.

## Civitai Images & Downloads

Image & Model Library is disabled by default. Set `STUDIO_ENABLE_PRESETS=1` only on instances that should offer it; keep it unset or `0` everywhere else. The server enforces this switch for preset data, thumbnails, imports, provider downloads and Civitai token settings, and the desktop and phone controls follow the server’s feature flag. Existing catalogue downloads remain available independently.

Open **Image & Model Library** from the desktop toolbar or phone gallery. **Images** accepts a Civitai image link and downloads the full image into this studio’s gallery with its prompt, generation settings, checkpoint and LoRA associations. Missing supported resources queue automatically through the configured downloader; filename conflicts and unavailable resources remain explicit. Existing saved presets migrate to gallery images when the library opens. Imported images use the normal viewer, settings reuse, reference selection, Hidden and deletion behaviour. Deleting an image keeps downloaded models.

**Use Settings** applies the image’s recipe to its installed image workflow without starting a generation. Exact resource matches use SHA-256, including renamed files. Missing LoRAs, unknown weights and unsupported resource types require attention; **Use Prompt Only** is available independently. Civitai metadata is optional, and additional processing such as ControlNet, high-resolution passes and CLIP skip needs a matching workflow. Imported settings cannot guarantee an identical image.

**Models** accepts Civitai model links (including `modelVersionId`) and Hugging Face links to individual SafeTensors or GGUF files. Local downloads use the existing resumable queue and check published SHA-256 values. Hugging Face revisions are pinned to a commit when previewed. A filename conflict is never resolved by replacing the existing file automatically.

Public imports do not require a token. Set `CIVITAI_API_TOKEN` in the server environment for resources your account can access. Tokens are kept on the server and are never returned to the browser or forwarded to the image/file CDN. Imports, image deletion and model downloads are available at the server or from a signed-in device. Provider credential changes retain the existing admin boundary; the library does not expose credential controls.

