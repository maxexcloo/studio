# Configuration

Copy `.env.example` to `.env` when you need different ports or paths.

```bash
HOST=127.0.0.1
PORT=8787
STUDIO_DATA_DIR=./data
STUDIO_COMFY_OUTPUT_DIR=
```

`STUDIO_COMFY_OUTPUT_DIR` is optional; the folder is usually found without it. The folder is needed to delete files along with their cards. The retained configuration API accepts only a folder ComfyUI writes to (one with ComfyUI's images, or next to its `models` or `custom_nodes`).

Single-user mode answers only the computer running Studio; other devices need [account mode](#multi-user-mode). `STUDIO_ALLOWED_HOSTS` lists extra names to answer to (comma-separated); TLS terminates at the proxy in front of Studio. See [Security](./SECURITY.md) and [Accounts & Devices](./TROUBLESHOOTING.md#accounts--devices).

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

The deployment defines the workers; Studio does not edit them:

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

On Kubernetes, leave `STUDIO_WORKERS` unset: the image and video workloads in
[`STUDIO_KUBERNETES_WORKLOADS`](#queue-sessions--runtime-control) are the
workers, one per address. When `STUDIO_WORKERS` is set, it lists the workers
instead. Without either, Studio starts with no workers.

**Routing:** queued work pins its selected worker and waits while it is offline. A user may explicitly permit fallback to another worker advertising the same profile. Studio never substitutes an unavailable model or switches to a cloud provider implicitly, except for [Animate](#cloud-models), which never waits on a stopped video worker. Worker capability checks apply before submission. Which GPU workloads run is [runtime control](#queue-sessions--runtime-control).

## Cloud Models

Set `STUDIO_CLIPROXYAPI_URL` to the CLIProxyAPI base URL and `STUDIO_CLIPROXYAPI_KEY` to its server-side credential; Studio calls it directly, never through a ComfyUI worker. A cloud profile is a workflow whose every mode is one `GrokMedia` node, and it is listed only while the provider advertises its model. `STUDIO_CLIPROXYAPI_IMAGE_MODEL` and `STUDIO_CLIPROXYAPI_VIDEO_MODEL` pick the model for a profile that names none; otherwise the first advertised one is used. A workflow that mixes `GrokMedia` with other nodes runs nowhere.

Direct cloud work is independent of GPU admission. Studio records asynchronous video request IDs and recovers them before resubmitting. A synchronous image request has no resumable provider ID: an interrupted response remains visible as unknown and is never retried automatically. Cancelling that operation ends Studio's wait; the provider may still finish or charge for work already accepted. Saved results retain the actual provider/model and the existing media result-link shape.

Cloud Models and uncensored access remain per-user permissions. Credentials never reach the browser or media-download URLs.

**Animate** (the viewer's motion themes and Animate in Composer, tile and context menus, Chat's staged and requested animations, the Dream deck and MCP Reuse) picks its video profile with one rule: while the local video worker answers, the account's default local first-frame profile (otherwise the usual local first-frame pick); while it is stopped, a Grok video profile the account is granted; the Animate menu shows this before anything queues, and Chat and MCP replies say so. With neither, it says so and queues nothing. The video takes the image's proportions at the profile's default size, snapped for Grok to the nearest aspect it accepts. A profile the user chooses in the composer, a video model selected in Chat or an MCP `profile_id` always wins.

While the local video worker is off, other MCP video is refused with a note that Grok can be asked for. **Settings › Models › Video Cloud Fallback** (`STUDIO_VIDEO_CLOUD_FALLBACK=1`, off by default) sends it to a cloud profile the account is granted instead, and the reply says it went to the cloud. It applies at once and never affects Animate, Studio's own composer or held video work.

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

- **Every request needs an account,** including requests from this computer. The first visit on the computer running Studio creates the recovery administrator; after that, administrators add accounts in **Settings › Users**. Accounts sign in with their email address, which is the account's username; accounts created before this with other usernames keep signing in with them.
- **Single sign-on (Pocket ID or another OpenID Connect provider):** set `STUDIO_OIDC_ISSUER`, `STUDIO_OIDC_CLIENT_ID` and `STUDIO_OIDC_REDIRECT_URI` (`https://<studio>/api/accounts/oidc/callback`). Public PKCE clients need no secret; `STUDIO_OIDC_CLIENT_SECRET` supports confidential clients, and `STUDIO_OIDC_LABEL` names the button (Single Sign-On by default). Setting only some of these stops Studio at startup and names the missing ones. The provider only proves identity. A verified email that matches an account's username links that account. Any other identity becomes a pending account, which an administrator approves (onto the default group, or by assigning one), or, with a default and Require Approval off, an account on the default at once. Roles never come from the provider.
- **Probes stay open:** `/api/ping` (liveness) and `/api/ready` (readiness: the data folder is writable) answer without an account. ComfyUI workers being down does not make Studio unready.
- **Administrators** have full access. **Ordinary accounts** are in one group (an access profile on the server), which lists the local generation profiles they may use (or All, which includes ones added later) and switches for cloud models, galleries, LoRAs, uncensored models, prompt history, references and image/video generation. Cloud (Grok) profiles follow the Cloud Models feature, and a profile marked `"uncensored": true` in its `studio` block also needs Uncensored Models. Other new generation profiles stay administrator-only until a group grants them. Presets & Civitai Imports stay administrator-only for now.
- **Default group:** Studio adds a User group (no uncensored models, cloud models, LoRAs or presets) when no group has that ID, and removes the Administrator group earlier versions added unless it has members or is the default. Administrators edit groups in **Settings › Groups** and pick one default group under **Settings › Users › New Account Policy**; it applies to accounts added in **Settings › Users**, to first single sign-on and to chat gateway accounts. **Require Approval** beside it (on until an administrator turns it off) keeps new single sign-on and chat gateway accounts waiting in Users; assigning an access group approves a waiting account. Turned off, they start on the default at once. Without a default, single sign-on accounts wait for approval and the gateway creates none.
- **Each account's outputs, prompt history, LoRA stacks, references and jobs are private** and saved under its own output subfolder. Ordinary accounts only reach reviewed, owner-checked routes; studio administration (models, connection, updates, presets, trash) stays with administrators. Run grouping is unavailable to accounts.
- **Personal MCP tokens** are issued once in Settings, stored only as hashes, and work only for MCP. They are never an administrator credential. Rotating or revoking a token leaves existing result links working; a result link ends when its output is hidden or deleted.
- **Records from single-user mode have no owner** and stay out of every account's gallery until they are explicitly migrated to an account.

Session cookies are marked `Secure` over HTTPS, including behind a proxy that sends `X-Forwarded-Proto: https`.

MCP clients connect in one of three ways in multi-user mode:

- **Personal token:** a client sends the account's own token as `Authorization: Bearer <token>` to `/mcp`. A client that can send no headers, such as a Grok custom connector, uses `/mcp/<token>` as its complete URL. Only a personal token works in the path; the shared gateway and control keys are header-only. URLs can reach proxy logs and browser history, so mint a token for that one client and revoke it if it leaks. Studio has no OAuth (discovery gets a plain 404), and the MCP endpoints answer a browser's CORS preflight so a connector can validate its URL from a page.
- **Trusted gateway:** a chat gateway such as LiteLLM sends the shared `STUDIO_MCP_API_KEY` together with its own user ID in `x-ai-user-id`. Studio acts for that user only once the ID is linked to an account. When the gateway also forwards the user's email in `x-ai-user-email` and it matches an enabled, approved account's username (ignoring case), Studio links the ID to that account on its first request, recorded like an administrator's link; an unknown email creates an account only when a default access group is configured, subject to the new-account approval policy. Otherwise an administrator links the ID under **Settings › Users › Chat Gateway**, where unlinked IDs are listed; **Dismiss** removes one from the list until the gateway sends it again. Unlinked IDs still see the tools, but every call only returns a message asking for the link, so the chat explains the problem instead of reporting no tools. Unlinking an ID whose email matches an enabled account lets it link again on its next request; disable the account to stop it.
- **GPU control:** `CONTROL_MCP_API_KEY` (header-only, distinct from `STUDIO_MCP_API_KEY`) gets only the GPU tools (GPUStatus, Workloads, Preview, Apply, Mode, Restart, Operation) and reaches no galleries or accounts. They drive Studio's own [runtime control](#queue-sessions--runtime-control), so the key needs `STUDIO_KUBERNETES_WORKLOADS`.

MCP's own requests to the studio use a per-process internal credential. It is accepted only from this computer and only for MCP's routes.

### MCP Admin Tools & External Chat

Administrator MCP tools retain their published names and permission boundaries. Library transfers and downloads use the same domain services as HTTP. Administrators can edit and approve runtime-owned catalogue, profile and guide definitions through the retained mutation tools, and manage groups with the Accounts tool (list, save, set the default or delete an empty non-default group, move an account or disable it). Personal MCP tokens remain distinct from browser administrator credentials.

Studio's Chat tab uses its own OpenAI-compatible text gateway, configured with three server-side settings:

- `STUDIO_CHAT_GATEWAY_URL`: gateway root, `/v1` base or full `/chat/completions` endpoint.
- `STUDIO_CHAT_GATEWAY_KEY`: gateway credential, never sent to the browser.
- `STUDIO_CHAT_GATEWAY_MODELS`: comma-separated permitted model IDs or prefixes ending in `*`, such as `ai/*,deepseek/specific`. Missing or empty configuration leaves Chat unavailable. Chat only offers models actually returned by this gateway's model catalogue; the first permitted model is the default. Selected models are checked again for every message.

Chat uses the Prompt Assistant account permission. Its gateway is independent of prompt assistance. Chat preserves the selected media model and backend. Explicit requests to create, refine or animate media use the normal generation admission path; discussion alone does not generate media. Editing and submitting a generation card records its changed settings in the conversation, then generates once after the assistant finishes its reply. Each iteration retains the assistant's text, generation inputs, actual text model and linked results; a model without a name of its own (a routing alias such as `ai/text`) is listed under the model that last answered for it. Interrupted text responses retain their partial content, and recorded media actions are not automatically resubmitted.

MCP assistant records survive a restart and preserve who prepared each generation. Results and signed links stay scoped to the owning account.

`STUDIO_ENABLE_GROK=0` and `STUDIO_ENABLE_LORAS=0` disable those optional catalogue features for everyone, administrators included, and reject unavailable generation settings; the matching group features show as locked. Both are enabled by default and Settings no longer switches them. In account mode, a LoRAs or Cloud Models value saved earlier from Settings is carried into every group once (a group keeps a feature only where the switch had it on) and then dropped from Studio's own env file.

`STUDIO_DEFAULT_IMAGE_PROFILE` and `STUDIO_DEFAULT_VIDEO_PROFILE` optionally select the instance’s default ready workflow IDs. They apply to a fresh composer and mode changes; existing drafts remain intact. Missing or unavailable IDs fall back to the first ready profile. Reference-image variants run separately to limit GPU memory. Image workflows apply their batch count when selected; fresh image preferences default to one, while video and workflows without batch support use one.

`STUDIO_THUMBNAIL_CACHE_MB` caps the gallery's thumbnail cache (2048 by default; the least recently shown go first).

Model downloads follow the Hugging Face tools' own settings. `HF_TOKEN` opens gated repos and is only sent to huggingface.co, `HF_ENDPOINT` points downloads at a mirror, and `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` send them through a proxy. Existing administrator credential APIs remain available; the rewritten settings page does not expose provider credentials.

## Civitai Images & Downloads

Imports into the **Library** are disabled by default. Set `STUDIO_ENABLE_PRESETS=1` only on instances that should offer them; keep it unset or `0` everywhere else. The server enforces this switch for saved images, thumbnails, imports, provider downloads and Civitai token settings, and the Library's Imports and Inspiration sections follow the server’s feature flag. The Library itself (LoRAs, Models and Downloads) is always there for administrators, and existing catalogue downloads remain available independently.

Open the **Library** from the navigation. **Imports** accepts a Civitai image or model link or a Hugging Face file or repository link and records each import in `library/imports/<id>.json` with its grade (Exact, Close or Partial) and reasons. A Civitai image appears in **Inspiration** and in this studio’s gallery with its prompt, generation settings, checkpoint and LoRA associations; a LoRA writes its catalogue entry; a checkpoint is recorded. Missing files wait for **Download Missing**, which queues them through the configured downloader; paid, early-access and restricted Civitai files are never downloaded and show why. Filename conflicts stay explicit. Existing saved presets migrate to gallery images when the Library opens. Imported images use the normal viewer, settings reuse, reference selection and deletion behaviour. Deleting an image keeps downloaded models.

**Use Settings** applies the image’s recipe to its installed image workflow without starting a generation. Exact resource matches use SHA-256, including renamed files. Missing LoRAs, unknown weights and unsupported resource types require attention; **Use Prompt** is available independently. Civitai metadata is optional, and additional processing such as ControlNet, high-resolution passes and CLIP skip needs a matching workflow. Imported settings cannot guarantee an identical image.

**Imports** also accepts Civitai model links (including `modelVersionId`) and Hugging Face links to individual SafeTensors or GGUF files. Local downloads use the existing resumable queue and check published SHA-256 values. Hugging Face revisions are pinned to a commit when previewed. A filename conflict is never resolved by replacing the existing file automatically.

Public imports do not require a token. Set `CIVITAI_API_TOKEN` in the server environment for resources your account can access. Tokens are kept on the server and are never returned to the browser or forwarded to the image/file CDN. Imports, image deletion and model downloads are available to administrators (in single-user mode, the computer running Studio). Provider credential changes retain the existing admin boundary; the library does not expose credential controls.

## Prompt Assistant

The prompt assistant uses the MCP prompt writer's OpenAI-compatible gateway: `STUDIO_PROMPT_WRITER_URL`, `STUDIO_PROMPT_WRITER_KEY` and `STUDIO_PROMPT_WRITER_MODEL`. Credentials remain server-side. Without the gateway, the assistant is off. Bifrost fixture compatibility is separate from live gateway verification.

- `STUDIO_ASSISTANT_MODEL`: the model that rewrites prompts (Spicy included), writes negatives, suggests LoRAs and describes images. Unset, it is `STUDIO_PROMPT_WRITER_MODEL`. MCP Generate keeps `STUDIO_PROMPT_WRITER_MODEL` either way.

Configure these in the deployment. The retained administrator integration APIs list gateway models (`GET /v1/models`) and whether the text model reads images. Studio asks the running text model itself: every text workload in [`STUDIO_KUBERNETES_WORKLOADS`](#queue-sessions--runtime-control) with replicas above zero must report `modalities.vision` on its own `/props`, asked with its `apiKeyEnv` key (Radiance and llama.cpp do), so switching workloads changes the answer within 30 seconds. With no text workload running, one that can't be asked, or no runtime control (single-user mode), the model counts as text-only. Reference reading, Describe and Gallery Captions all follow this answer. The rewritten settings page does not expose integration editing.

The **Prompt Assistant** group feature (an access profile on the server) gates every assistant route. It is on for the built-in groups; set it per group in **Settings › Groups**. Spicy also needs **Uncensored Models**. LoRA suggestions need **LoRAs**, and drafting guides and profiles is for administrators. Replies are never logged; logs carry only the operation, profile, timing and a short failure reason. Every call turns the model's thinking off (`reasoning_effort: "none"`), since each wants a short structured answer; it times out after 90 s and falls back: a rewrite returns the original prompt, a negative the guide's default, LoRA suggestions the word-matched candidates. Prompts written for a generation are the queue's [writing stage](#queue-sessions--runtime-control) instead: they never fall back, and an unusable reply is retried once before the item fails with the cause (such as `empty reply` or `reply cut off at the token limit`).

Each account's **Taste Profile** (Settings › Account; `GET`, `PUT` and `DELETE /api/taste`, `POST /api/taste/refresh`) is a short summary the assistant model keeps from the account's stars, compare votes (the winner is recorded as preferred over each other finished variant, a relative signal rather than a dislike), iterations and Dream keeps and discards, with their prompts, profiles and LoRAs; one action, such as a bulk star, adds at most 20 signals. It is stored in `studio.sqlite` as the `taste:<account id>` document. After every eight new signals Studio rewrites it in the background, at most every ten minutes and never while the text runtime is offline; an edited summary is kept and revised, not replaced. Accounts without **Prompt Assistant** can edit their summary, but nothing is sent to the text model. MCP's automatic model pick and its prompt writer read the summary (at most 500 characters) as context.

**Dream** (`GET /api/dream`, `PUT /api/dream/settings`, `POST /api/dream/:itemId/keep`, `/discard`, `/variations` and `/more`, `POST /api/dream/pairs/:pairId/answer`, `GET /api/dream/discarded`) makes results for an account while Studio is idle, from its taste profile and recent starred prompts. It is off for every account until turned on; the settings (buffer 12 unseen, 40 images and 4 videos a day, videos and Spicy off) are the `dream:<account id>` document in `studio.sqlite`. Dream queues one job at a time across Studio, at the lowest queue tier, only while no person's or MCP's job is queued or running and no text work (a Chat reply or admitted local text) is active; a waiting Dream job is cancelled as soon as other work arrives, and a started one finishes. Dream jobs stay out of the queue list, so Cancel All and Cancel Pending leave them alone; pausing Dream cancels its waiting job. It stops at the unseen buffer and at the day's caps (the server's local day), uses only ready local profiles the account may use (the most-starred in the last 30 days, else the default), and skips while the text model or the kind's worker is offline, logging the reason once. Accounts without **Prompt Assistant** get nothing. Videos animate a kept or starred image. Spicy needs **Uncensored Models**. Results stay out of the gallery, its filters, search, exports and MCP until kept; keep and discard are taste signals, starring an unseen result anywhere keeps it, every discard is kept (with no cap), and Variations keeps the image and queues new seeds as the person's own job. More Like This keeps an image and steers the next four ideas toward it, on its profile.

Every fourth image of the day is a **comparison** when a kept or starred image the account generated (with a ready local profile and no references) can start one: two Dream jobs with its prompt and one shared seed, alike but for one thing, in random order: the model (another ready local profile), a LoRA (with or without), a LoRA's strength, steps, guidance or the prompt's wording (the text model rewords it). Each image starts at most one comparison. Both sides show together once both finish (a side whose other failed shows alone) and are answered with `a`, `b`, `both` or `neither` to the question about what varies (Which Model?, Which LoRA?, Which LoRA Strength?, Which Steps?, Which Guidance?, Which Wording?): the chosen sides are kept, the rest discarded, and one taste signal records the question and answer (`preferred` over the other side, `pair-both` or `pair-neither`).

**Finish Starred Images** (**Settings › Studio**; `GET /api/finishing`, `PUT /api/finishing/settings` with `enabled`, `quality` of `fast`, `balanced` or `high`, and `faceDetail`) smart-upscales the images an account stars while Studio is idle. It is off for every account until turned on; the settings (Balanced quality, Face Detail on) and the waiting list are the `finishing:<account id>` document in `studio.sqlite`. Starring a finished gallery image without an upscale, made or queued, adds it to the list once; unstarring takes it off until its upscale starts, and turning the setting off empties the list. By the captioner's rule (no job of anyone's, Dream's included, queued or running and no text work), Studio queues one list image at a time through the same path as **Upscale**, at the lowest queue tier, on the upscale worker only and never in the cloud, at automatic size; a waiting one is cancelled and put back as soon as other work arrives, and a started one finishes. Face Detail joins only an image whose prompt shows a full-body person (the MCP rule) and only while the worker has the face detector and Impact Pack nodes. While the worker or the SeedVR2 nodes or models are unavailable the list waits and the log says why once. Accounts without **Gallery** cannot use it.

Dream results load up to two of the account's starred LoRAs that the chosen profile can load and that suit its model family (another family's LoRA is left out rather than failing the run), at their saved strength within any published range, and the prompt writer is told which. Dream shows and learns only from the account's own Studio generations: gallery records of a job Studio queued for the account (composer, Chat, MCP or Dream), never uploads, imports or records without such a job. **Calibration** (`GET /api/dream/calibration?limit=`, `POST /api/dream/calibration` with `liked` and `passed` item IDs) mixes those finished images at least a day old into the Dream deck, as single cards and Which Image? pairs (answered A, B, Both or Neither), without using the GPU, even while Dream is off. A choice records `calibrate-like` or `calibrate-pass` taste signals and changes nothing in the gallery (Star on a calibration card also stars the image); images not yet judged come first, and the judged item IDs are kept in the `dream:<account id>` document.

**Gallery Titles** give every finished image and video a title of a few words that the assistant model summarises from its prompt (`title` on the gallery record), shown wherever an item's title appears and searched with it; until one is written, the prompt's first words stand in. A result is titled as it completes; a Dream prompt brings its title from the writing stage. The rest of the gallery is titled while Studio is idle, by the captions' rule and at a pass's pace (two at a time, newest first), yielding as soon as other work arrives. Items without a prompt, and accounts without **Prompt Assistant**, are never titled, and there is no cloud fallback.

**Gallery Captions** (**Settings › Models**, `STUDIO_GALLERY_CAPTIONS`, on by default; `0` turns them off) let gallery search match what an image shows as well as its prompt. While Studio is idle, by the same rule as Dream (Dream's own jobs count as work here), the assistant model describes finished images, newest first, from a copy of at most 512 px. It sees only the image, never the prompt, and is asked for visible facts: subjects and objects; people's apparent age range, body type, hair, skin tone and apparent ethnicity, clothing and nudity, pose and expression; the setting; actions; the medium, lighting, colours, mood and framing; and legible text verbatim, with no judgement or guessed names. The reply is JSON with the text and 8–15 lowercase tags; a plain-text reply is kept without tags. The caption (`caption` on the gallery record: `text` up to 600 characters, up to 15 `tags`, `model`, `at` and the format `version`) is searched with its tags. Normally new images are captioned one at a time, at most one every 10 seconds and 500 a day (the count is kept in `studio.sqlite`). **Settings › Maintenance › Caption Gallery** (administrators; `GET /api/gallery/captions`, `POST /api/gallery/captions/start` with a `scope`, and `/stop`) runs a pass instead: two at a time with no spacing or daily cap until it has captioned every image in its scope or is stopped. **Out of Date** (`outdated`) takes images without a caption or with one from older rules, **Missing** (`missing`) only those without one, and **All** (`all`) redoes every caption once. Settings shows how many each scope takes and, during a pass, done of total, failures, the rate and the time left. The pass is the `captions` document in `studio.sqlite`, so a restart resumes a running pass and reports a stopped or finished one. Both yield as soon as other work arrives and try those images again later. An image that fails is skipped until the next start; three failures in a row pause captioning for a minute instead. Captions need a running text model that reads images ([as above](#prompt-assistant)); otherwise they are skipped and the log says so once. Accounts without **Prompt Assistant** are never captioned, and there is no cloud fallback.

**Image Search** (**Settings › Models**, `STUDIO_IMAGE_SEARCH`, on by default; `0` turns it off; always off in demo mode) lets gallery search also find images that look like the words, whatever their prompt or caption says. Studio reads finished images with [SigLIP 2](https://huggingface.co/google/siglip2-base-patch16-224) (base, patch 16, 224 px; Apache-2.0) on its own CPU through onnxruntime-node, using half the cores. The first image to read downloads the ONNX model (the full-precision vision encoder and the int8 text encoder, about 690 MB, from `onnx-community/siglip2-base-patch16-224-ONNX` at a pinned revision; `HF_ENDPOINT`, `HF_TOKEN` and proxies apply) into `image-search/<revision>/` in the data folder; a new revision replaces the folder and starts the vectors again. Each image becomes a float16 vector in the `studio_image_vectors` table of `studio.sqlite` (about 1.5 KB an image) and is kept in memory; deleting an image deletes its vector, and an Index Gallery pass first drops vectors whose image is gone. A search compares the words with every vector and adds the images whose cosine similarity is at least 0.08 to those whose text matches, in gallery order; filters, favourites and Chats still apply, and while the model is missing or nothing has been read the search is text only. New results are read as they finish; the rest follow the Gallery Captions idle rules above, one every 10 seconds and 500 a day, and **Settings › Maintenance › Index Gallery** (administrators; `GET /api/gallery/embeddings`, `POST /api/gallery/embeddings/start` and `/stop`, the `image-search` document) runs a pass over the rest the same way. Images never leave Studio, so every account's are read.

**Suggestions** (`POST /api/suggestions` with `surface` `composer`, `viewer` or `chat`) ask the assistant model for three prompt ideas from the taste profile and liked prompts, three or four next steps for a finished image from its prompt and settings, or a paragraph of taste context. Answers are cached per account and input for ten minutes. An image's next steps are kept with its run (`nextSteps` on the gallery record, left out of gallery pages) and mostly written ahead of time: while Studio is idle, by the captions' rule and trickle pace (newest first, at most one every 10 seconds and 500 a day), the assistant model writes them for finished images that have none, seeing the image too when the running model reads images. The viewer shows the kept ones at once; `fresh: true` asks for different ones, which replace them. Accounts without **Prompt Assistant**, or while the text runtime is offline, get an empty list with the reason; there is no fallback text and no cloud model. Chat's assistant also receives the account's taste summary as context.

`mise run eval:assistant` replays the recorded cases in `backend/fixtures/assistant-evals/` against the live gateway, using the variables above, and scores them; `--record` writes the live replies back for review. CI only scores the recorded replies.

## Profiles, Guides & Catalogue

Studio owns editable live definitions in its data directory: profiles in `workflows/`, prompting guides in `guides/`, and catalogue changes in `library/`. Administrators edit and approve these in Library; user presets remain account-owned runtime data. Existing identifiers are preserved; each profile maps its controls in its `studio` block.

**Resolution:** an image run on a profile with adjustable width and height draws at a resolution tier, `1K`, `2K` or `4K` (the long edge: 1024, 2048 or 4096 px, each side rounded to the profile's step), 1K unless the composer, Chat, Compare, Dream or MCP Generate's `resolution` names another. Studio applies it when the job is admitted, so a profile's default width and height (and an MCP call's `width`/`height`) give only the aspect. Where the model family doesn't draw a tier itself (`native` in the family catalogue), the run draws at 2K where it can, else 1K, and Smart upscale in the same job takes it to the tier. Videos, cloud profiles, a painted mask and a reference that frames the output keep their own size.

A guide store's profile bindings (`profiles`: which pack, variant and mode a `custom:<id>` uses; `variants`; `negatives`) are one versioned document beside the packs: `GET`/`PUT /api/profiles/guide-bindings` (`{bindings, baseHash}`), with `versions`, `revert` and `approve` like a pack, and the Profiles and ProfileEdit admin MCP tools with `target: "bindings"` (a merge patch's `null` removes a binding).

The sample profiles in `backend/samples/` seed a data folder that has never held a profile (a new install or local development); after that, the data folder is the only source. Exports through the retained administrator API are the backup.

Settings › Profiles › Merge Duplicate Profiles is an explicit administrator action, never run at startup. It previews profiles with the same name and kind whose graph (node titles aside), profile block (apart from id, name and description), guide binding, negatives and AI-Drafted state are identical, keeps the id that follows `<kind>-…-<backend>` and lists same-named profiles that differ or have no single id to keep. Applying copies the removed files and the previous aliases, workflow preferences, guides and LoRA stacks to `backups/profile-merges/<time>/`, records each removed id in `workflows/.studio-aliases.json` and removes its file; its version history stays. Workflow preferences and every account's LoRA stacks and strengths move to the kept id, and the removed ids' guide bindings go. Records that name an old id (gallery items, presets, jobs, Chats, MCP calls, access grants, taste signals) are left as they are and resolve to the kept profile. Exports carry the aliases as `profile-aliases.json`.

### Profile Backends

A profile can run one model on Radiance or ComfyUI. Its `studio` block then holds the shared fields (`id`, `name`, `kind`, `family`, `uncensored`, `prompting`; the guide binding and negatives follow the profile id), the backend it runs on and each backend's own block with its graph:

```json
{
  "studio": {
    "id": "image-krea2-turbo",
    "name": "Krea 2 Turbo · Fast · 8 Steps",
    "kind": "image",
    "family": "krea2",
    "backend": "radiance",
    "backends": {
      "comfyui": { "graph": {}, "controls": {}, "mediaInputs": [], "defaults": {} },
      "radiance": { "graph": {}, "controls": {}, "loraStack": {}, "defaults": {} }
    }
  }
}
```

Each backend's fields (`controls`, `mediaInputs`, `loraStack`, `defaults`, `capabilities`, `aspectRatios`, `imageModes`, `requiredNodes`, `description` and the rest) replace the shared ones of the same name, so the profile runs as the single-graph profile they make together. `backend` must name one of `backends`, which take `comfyui` and `radiance`; saving checks every backend's graph and connections.

Readiness, worker routing, validation, the graph, timings and labels follow the backend a run uses. A backend that isn't ready shows the profile as Needs Setup with the reason; Studio never runs it on the other backend instead. Switching `backend` (the Backend select in Settings › Profiles) is an ordinary versioned edit. Jobs and gallery records keep `profileBackend`: Exact Repeat, Recreate and MCP's Reuse run on the backend that ran while the profile still has it, otherwise on its current one, with a note.

Settings › Profiles › Combine Backends is an explicit administrator action, never run at startup. It previews pairs of one model's profiles (the same kind, family and name before its first `·`), one running Radiance nodes and one ComfyUI's, with what differs (steps, size, references, modes, LoRAs, guide and negative prompt). The administrator picks pairs, each one's name and default backend; a profile joins one pair at most. Applying refuses a stale preview, copies both files, the aliases, workflow preferences, `guides/prompting.json`, LoRA stacks and `timings.json` to `backups/profile-backends/<time>/`, writes the combined profile as a new profile (its id is the ComfyUI id without `-comfyui`) with the default backend's guide binding and negatives and drops both old ids' guide entries, records both old ids in `workflows/.studio-aliases.json` as `{"to": "<combined id>", "backend": "<its backend>"}`, removes their files (their version history stays) and moves their workflow preferences, every account's LoRA stacks and strengths, and run timings (per backend) to the combined profile. An old id in a record, a generation request or an MCP call runs on that id's backend (Exact Repeat, Recreate and Reuse included); records themselves are not rewritten. Applying again does nothing; an apply that stopped part way finishes. Exports carry the aliases with their backends. The CombineBackends admin MCP tool previews and applies the same way from chat.

## SQLite Migration & Rollback

Native Node SQLite stores the persistent queue, sessions, Chat messages and user presets in `studio.sqlite`. Accounts, account sessions, gallery metadata and deletion markers move into its document tables through an explicit offline migration. Until that migration commits, the retained JSON stores remain authoritative.

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

Verify account ownership, profile identifiers and existing result links on the copy. For rollback, stop the rewrite, retain its complete SQLite/media state, restore the verified pre-migration metadata beside the media, then start the previous application image. Do not run old and new writers against the same data directory. Post-migration work must be retained or explicitly mapped before reverting to the older JSON-only application.

Development uses `data/development` with SQLite migration applied only to that isolated directory. Recovery follows recorded job IDs and never scans or adopts a shared worker's full history.

The same command also finishes what Combine Backends and Merge Duplicate Profiles did before they moved preferences and pruned guides (`backend/combined-profiles.js`): following `workflows/.studio-aliases.json`, each merged id's favourite and last use in `workflow-preferences.json` and its LoRA stack, strengths and snapshots in every `lora-stacks.json` move to the id it became, and guide bindings, variants and negatives keyed by a `custom:<id>` whose profile file is gone are removed as a new bindings version. The dry run reports them under `combinedProfiles`; `--apply` writes them with Studio stopped, without a backup.

It also renames the old `nsfw` marker to `uncensored` (`backend/uncensored-marker.js`): each profile's `studio` block, as a new version; every catalogue entry, catalogue source file and import record; and each group's `nsfwModels` feature, which becomes **Uncensored Models**. Earlier profile versions keep their text. The dry run reports the changes under `uncensoredMarker`; `--apply` writes them with Studio stopped, without a backup.

With `--dream-owner <account id>`, naming the one account that has used Dream, it also clears Dream answers left on other accounts' records (`backend/dream-ownership.js`): Dream marks on gallery items another account owns, and that account's calibration answers and Dream taste signals about those items. Its own marks, answers and taste summary stay. The dry run reports the counts under `dreamOwnership`; `--apply` writes them with Studio stopped, without a backup.

## Queue, Sessions & Runtime Control

`/api/sessions` stores generation inputs and result relationships; `/api/queue` exposes writing, queued, waiting, starting, running, saving, completed, failed and cancelled operations.

**Writing** is the first stage of a generation whose prompt the prompt assistant writes: the viewer's Animate themes, MCP Generate and Reuse when Studio writes the prompt from the request, and Dream. One click or call queues the job; it writes its prompt, then queues for its worker, with no review pause. The thinking (`reasoning_content` and `<think>` blocks) and the prompt stream into the queue item, and the result keeps the written prompt with its text model and thinking, collapsed under the prompt in Details. The shared text model writes at most two prompts at once, higher queue tiers first and then in order; the rest wait in their writing stage. A failed write fails the item with the reason (Retry writes it again); cancelling stops the writing; a restart writes it afresh. MCP's status and replies leave the thinking out. Users can cancel their pending jobs and retry failed jobs. Recorded provider jobs are recovered before any resubmission. Ambiguous submission outcomes stay visible for investigation rather than creating duplicate generations.

Work waits for the selected worker by default. Independent resources can run concurrently. A worker's admission remains held until results are safely saved. Runtime status is administrator-only.

Studio switches the GPU workloads itself: each is a Kubernetes deployment it scales between 0 and 1 replicas. `STUDIO_KUBERNETES_GPUS` gives the GPUs per node pool and `STUDIO_KUBERNETES_WORKLOADS` the deployments, keyed by a stable workload id (kubelab's `apps/base/studio` holds the full value):

```bash
STUDIO_KUBERNETES_GPUS='{"gpu": 2, "gaming": 1}'
STUDIO_KUBERNETES_WORKLOADS='{
  "comfyui": {"kind": "image", "label": "Image", "namespace": "comfyui", "deployment": "comfyui", "pool": "gpu", "gpus": 1, "url": "http://comfyui.comfyui.svc.cluster.local:8188", "worker": "primary", "capabilities": ["image", "upscale", "models"]}
}'
```

`kind` is `image`, `video` or `text`; `url` is the workload's direct address, which several deployments may share. Without `STUDIO_WORKERS`, each address of the image and video workloads is one [worker](#workers): `worker` gives its id (else the first workload's id; keep `primary` and `video` so earlier jobs keep their worker) and `capabilities` what it runs (else the workloads' kinds); with `STUDIO_WORKERS`, media workloads match their worker by address. Text workloads name the variable holding their Radiance key in `apiKeyEnv`. A malformed value stops Studio at start with the reason. Studio uses its pod's service account, which needs a role in each workload namespace to read deployments and pods and to update `deployments/scale`; `STUDIO_KUBERNETES_URL` (such as `kubectl proxy`) replaces it for local development.

**Settings › Workers** shows each workload's state, GPU use and why a pod is not ready (such as a GPU claim that cannot be allocated). An administrator ticks the workloads that should run and reviews a preview before applying it; every workload left out stops. Restart scales a running workload to 0 and back. One change runs at a time: Studio stops accepting new work on the workloads that leave, waits for their accepted work to finish and save, scales them to 0, waits for their pods to go (their GPU claims are released only then), then starts the others and waits for them to be ready. Each change is recorded with its requester, timestamps, steps and the placement before and after, and the history survives restarts; a change cut short by a restart is marked interrupted. A deployment stopped outside Studio, such as by a Flux upgrade that resets replicas, shows as changed outside Studio.

Automatic control (`STUDIO_RUNTIME_AUTOMATIC=1`, off by default) starts and stops only media (image and video) workloads. Queued work for a stopped media workload starts it, stopping the media workloads in its pool it needs room from (idle ones first), and waits with "Waiting for <workload> to start". It never stops or starts a text workload, because LibreChat and Bifrost call text models directly and Studio cannot see those requests: if a running text workload holds the GPUs the media workload needs, nothing changes and the work waits with "Waiting for a GPU: <text workload> is running; stop it in Settings › Workers". A stopped text workload is started in Settings › Workers or with the control MCP tools, which may stop text as an explicit choice. After an outside stop Studio restores its last applied placement, keeping any running text; while that text holds GPUs the placement needs, the restore waits. Without automatic control, work for a stopped workload waits with the reason that the worker is offline.
