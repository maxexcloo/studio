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

`HEISS_ENABLE_GROK=0`, `HEISS_ENABLE_TESSERA=0` and `HEISS_ENABLE_LORAS=0` disable those optional catalogue features and reject unavailable generation settings. All three are enabled by default.

`HEISS_DEFAULT_IMAGE_PROFILE` and `HEISS_DEFAULT_VIDEO_PROFILE` optionally select the instance’s default ready workflow IDs. They apply to a fresh composer and mode changes; existing drafts remain intact. Missing or unavailable IDs fall back to the first ready profile. Reference-image variants run separately to limit GPU memory. Image workflows apply their batch count when selected; fresh image preferences default to one, while video and workflows without batch support use one.

Also optional: `HEISS_NO_BROWSER=1` keeps the launcher from opening the browser, and `HEISS_THUMBNAIL_CACHE_MB` caps the gallery's thumbnail cache (2048 by default; the least recently shown go first).

Model downloads follow the Hugging Face tools' own settings. `HF_TOKEN` (or a token saved in **Settings › Models**) opens gated repos and is only sent to huggingface.co, `HF_ENDPOINT` points downloads at a mirror, and `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` send them through a proxy.
