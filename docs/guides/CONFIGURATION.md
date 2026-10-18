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

`HEISS_DEVICE_COOKIE_NAME` optionally gives each studio on the same hostname a distinct device sign-in cookie. The default remains `heiss_device`.

In multi-user mode, `HEISS_ACCOUNT_MAX_OUTSTANDING_JOBS` limits each ordinary account's queued and running generations (2 by default). Set a positive whole number to change the limit. Administrators are not limited by this setting.

`HEISS_ENABLE_GROK=0`, `HEISS_ENABLE_TESSERA=0` and `HEISS_ENABLE_LORAS=0` disable those optional catalogue features and reject unavailable generation settings. All three are enabled by default.

`HEISS_DEFAULT_IMAGE_PROFILE` and `HEISS_DEFAULT_VIDEO_PROFILE` optionally select the instance’s default ready workflow IDs. They apply to a fresh composer and mode changes; existing drafts remain intact. Missing or unavailable IDs fall back to the first ready profile. Reference-image variants run separately to limit GPU memory. Image workflows apply their batch count when selected; fresh image preferences default to one, while video and workflows without batch support use one.

Also optional: `HEISS_COMFY_SEARCH=0` keeps HEISS on `COMFY_URL` (the **Find ComfyUI on its own** switch under Settings › Connection › Change address; by default, when that doesn't answer, HEISS looks on 8188 and 8000 and switches to whatever ComfyUI answers there), `HEISS_NO_BROWSER=1` keeps the launcher from opening the browser, and `HEISS_THUMBNAIL_CACHE_MB` caps the gallery's thumbnail cache (2048 by default; the least recently shown go first).

Model downloads follow the Hugging Face tools' own settings. `HF_TOKEN` (or a token saved in **Settings › Models**) opens gated repos and is only sent to huggingface.co, `HF_ENDPOINT` points downloads at a mirror, and `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` send them through a proxy.

## Civitai Images & Downloads

Image & Model Library is disabled by default. Set `HEISS_ENABLE_PRESETS=1` only on the secondary instance; keep it unset or `0` on the primary instance. The server enforces this switch for preset data, thumbnails, imports, provider downloads and Civitai token settings, and the desktop and phone controls follow the server’s feature flag. Existing catalogue downloads remain available independently.

Open **Image & Model Library** from the desktop toolbar or phone gallery. **Images** accepts a Civitai image link and downloads the full image into this studio’s gallery with its prompt, generation settings, checkpoint and LoRA associations. Missing supported resources queue automatically through the configured downloader; filename conflicts and unavailable resources remain explicit. Existing saved presets migrate to gallery images when the library opens. Imported images use the normal viewer, settings reuse, reference selection, Hidden and deletion behaviour. Deleting an image keeps downloaded models.

**Use Settings** applies the image’s recipe to its installed image workflow without starting a generation. Exact resource matches use SHA-256, including renamed files. Missing LoRAs, unknown weights and unsupported resource types require attention; **Use Prompt Only** is available independently. Civitai metadata is optional, and additional processing such as ControlNet, high-resolution passes and CLIP skip needs a matching workflow. Imported settings cannot guarantee an identical image.

**Models** accepts Civitai model links (including `modelVersionId`) and Hugging Face links to individual SafeTensors or GGUF files. Local downloads use the existing resumable queue and check published SHA-256 values. Hugging Face revisions are pinned to a commit when previewed. A filename conflict is never resolved by replacing the existing file automatically.

Public imports do not require a token. Set `CIVITAI_API_TOKEN` in the server environment for resources your account can access. Tokens are kept on the server and are never returned to the browser or forwarded to the image/file CDN. Imports, image deletion and model downloads are available at the server or from a signed-in device. Provider credential changes retain the existing admin boundary; the library does not expose credential controls.

For a read-only shared library managed by AI Control, configure `HEISS_MODEL_DOWNLOAD_URL` with its reachable API base URL, including `/api`, and `HEISS_MODEL_DOWNLOAD_TOKEN` with its API credential through the existing secret configuration. Derive the address and scheme from the AI Control deployment rather than copying another host’s endpoint. HEISS calls the existing `downloads` and `jobs/{id}` endpoints; it does not require changes to AI Control. This service uses its own provider credentials and download verification. Downloads continue while the dialog is closed. HEISS keeps delegated queue tracking for the current server session; a HEISS restart loses that tracking, while a job already accepted by AI Control continues there.

Shared downloads do not change Normal access, mount permissions or GPU allocation. Select newly downloaded files in AI Control before using them in Normal, then use **Check Again** in HEISS. The settings above only configure the connection; they do not deploy or restart either service.
