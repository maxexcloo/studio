# Configuration

Copy `.env.example` to `.env` when you need different ports or paths.

Set `STUDIO_ENABLE_BUILTIN_PROFILES=0` to use only imported workflows. This hides detected model profiles and bundled workflow templates from the generation catalogue; their definitions and model files remain intact. With a configuration mount, seeded and runtime profiles are used by default; standalone configuration keeps built-in profiles enabled. Set the switch explicitly to opt into detected model profiles.

```bash
HOST=127.0.0.1
PORT=8787
STUDIO_DATA_DIR=./data
STUDIO_COMFY_OUTPUT_DIR=
```

`STUDIO_COMFY_OUTPUT_DIR` is optional; the folder is usually found without it. The folder is needed to delete files along with their cards. The retained configuration API accepts only a folder ComfyUI writes to (one with ComfyUI's images, or next to its `models` or `custom_nodes`). A `.studio-trash` folder left there by an older version is emptied after 30 days (`STUDIO_TRASH_DAYS`).

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

Without `STUDIO_WORKERS`, Studio starts with no workers until an administrator
adds them in **Settings › Workers**, which saves Studio's own list to
`workers.json` in the data folder. Deployment workers come first and are never
written there.

**Routing:** queued work pins its selected worker and waits while it is offline. A user may explicitly permit fallback to another worker advertising the same profile. Studio never substitutes an unavailable model or switches to a cloud provider implicitly, except for [Animate](#cloud-models), which never waits on a stopped video worker. Worker capability checks apply before submission. Which GPU workloads run is [runtime control](#queue-sessions--runtime-control).

## Cloud Models

Set `STUDIO_CLIPROXYAPI_URL` to the CLIProxyAPI base URL and `STUDIO_CLIPROXYAPI_KEY` to its server-side credential; Studio calls it directly, never through a ComfyUI worker. A cloud profile is a workflow whose every mode is one `GrokMedia` node, and it is listed only while the provider advertises its model. `STUDIO_CLIPROXYAPI_IMAGE_MODEL` and `STUDIO_CLIPROXYAPI_VIDEO_MODEL` pick the model for a profile that names none; otherwise the first advertised one is used. A workflow that mixes `GrokMedia` with other nodes runs nowhere.

Direct cloud work is independent of GPU admission. Studio records asynchronous video request IDs and recovers them before resubmitting. A synchronous image request has no resumable provider ID: an interrupted response remains visible as unknown and is never retried automatically. Cancelling that operation ends Studio's wait; the provider may still finish or charge for work already accepted. Saved results retain the actual provider/model and the existing media result-link shape.

Cloud Models and NSFW access remain per-user permissions. Credentials never reach the browser or media-download URLs.

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

- **Every request needs an account,** including requests from this computer. The first visit on the computer running Studio creates the recovery administrator; after that, administrators add accounts in **Settings › Users**. Accounts sign in with their email address, which is the account's username; accounts created before this with other usernames keep signing in with them. Where nobody can open Studio on its own computer (a container platform), set `STUDIO_SETUP_TOKEN` to a random value of at least 32 characters (a shorter one stops Studio at startup): the first-administrator screen then accepts it from any address, until an account exists.
- **Single sign-on (Pocket ID or another OpenID Connect provider):** set `STUDIO_OIDC_ISSUER`, `STUDIO_OIDC_CLIENT_ID` and `STUDIO_OIDC_REDIRECT_URI` (`https://<studio>/api/accounts/oidc/callback`). Public PKCE clients need no secret; `STUDIO_OIDC_CLIENT_SECRET` supports confidential clients, and `STUDIO_OIDC_LABEL` names the button (Single Sign-On by default). Setting only some of these stops Studio at startup and names the missing ones. The provider only proves identity. A verified email that matches an account's username links that account. Any other identity becomes a pending account, which an administrator approves (onto the default group, or by assigning one), or, with a default and Require Approval off, an account on the default at once. Roles never come from the provider.
- **Probes stay open:** `/api/ping` (liveness) and `/api/ready` (readiness: the data folder is writable) answer without an account. ComfyUI workers being down does not make Studio unready.
- **Administrators** have full access. **Ordinary accounts** are in one group (an access profile on the server), which lists the local generation profiles they may use (or All, which includes ones added later) and switches for cloud models, galleries, LoRAs, NSFW models, prompt history, references and image/video generation. Cloud (Grok) profiles follow the Cloud Models feature, and a profile marked `"nsfw": true` in its `studio` block also needs NSFW Models. Other new generation profiles stay administrator-only until a group grants them. Presets & Civitai Imports stay administrator-only for now.
- **Default group:** Studio adds an Administrator (everything) and a User (no NSFW models, cloud models, LoRAs or presets) group when no group has those IDs. Administrators edit groups in **Settings › Groups** and pick one default group under **Settings › Users › New Account Policy**; it applies to accounts added in **Settings › Users**, to first single sign-on and to chat gateway accounts. **Require Approval** beside it (on until an administrator turns it off) keeps new single sign-on and chat gateway accounts waiting in Users; assigning an access group approves a waiting account. Turned off, they start on the default at once. Without a default, single sign-on accounts wait for approval and the gateway creates none.
- **Each account's outputs, prompt history, LoRA stacks, references and jobs are private** and saved under its own output subfolder. Ordinary accounts only reach reviewed, owner-checked routes; studio administration (models, library folders, connection, updates, presets, trash) stays with administrators. Run grouping is unavailable to accounts.
- **Personal MCP tokens** are issued once in Settings, stored only as hashes, and work only for MCP. They are never an administrator credential. Rotating or revoking a token leaves existing result links working; a result link ends when its output is hidden or deleted.
- **Records from single-user mode have no owner** and stay out of every account's gallery until they are explicitly migrated to an account.

`STUDIO_ACCOUNT_MAX_OUTSTANDING_JOBS` limits each ordinary account's queued and running generations (2 by default; anything but a positive whole number stops Studio at startup). Session cookies are marked `Secure` over HTTPS, including behind a proxy that sends `X-Forwarded-Proto: https`.

### Importing an Existing Studio

`backend/commands/import-studio.mjs` moves a whole single-user studio into one existing account of this studio. It runs against this studio's `STUDIO_DATA_DIR` and `STUDIO_MEDIA_DIR`; stop Studio first.

```bash
node backend/commands/import-studio.mjs --source-data /old/studio/data --source-outputs /old/comfy/output --account studio --label normal         # dry run
node backend/commands/import-studio.mjs --source-data /old/studio/data --source-outputs /old/comfy/output --account studio --label normal --apply
node backend/commands/import-studio.mjs --undo <batch>
```

- **What moves:** finished gallery outputs and their upscales (copied into the account's media folder), prompt and negative-prompt history, LoRA stacks and library, uploaded references, and MCP job and reference ownership.
- **What doesn't:** Hidden items from an older studio (they are encrypted), presets and workflow preferences (studio-wide), pending or failed records, and library-folder items. Each of these is counted in the dry run.
- **Without `--apply`,** nothing is written; the dry run lists every count and conflict.
- **The source is never changed.** Every target file that changes is backed up under `<STUDIO_DATA_DIR>/imports/<batch>/`, and `--undo` removes exactly what that import added.
- **Refused:** an import whose jobs are already in the gallery, an account that already has its own history files, or a result above `STUDIO_GALLERY_LIMIT`.

MCP clients connect in one of three ways in multi-user mode:

- **Personal token:** a client sends the account's own token as `Authorization: Bearer <token>` to `/mcp`. A client that can send no headers, such as a Grok custom connector, uses `/mcp/<token>` as its complete URL. Only a personal token works in the path; the shared gateway and control keys are header-only. URLs can reach proxy logs and browser history, so mint a token for that one client and revoke it if it leaks. Studio has no OAuth (discovery gets a plain 404), and the MCP endpoints answer a browser's CORS preflight so a connector can validate its URL from a page.
- **Trusted gateway:** a chat gateway such as LiteLLM sends the shared `STUDIO_MCP_API_KEY` together with its own user ID in `x-ai-user-id`. Studio acts for that user only once the ID is linked to an account. When the gateway also forwards the user's email in `x-ai-user-email` and it matches an enabled, approved account's username (ignoring case), Studio links the ID to that account on its first request, recorded like an administrator's link; an unknown email creates an account only when a default access group is configured, subject to the new-account approval policy. Otherwise an administrator links the ID under **Settings › Users › Chat Gateway**, where unlinked IDs are listed; **Dismiss** removes one from the list until the gateway sends it again. Unlinked IDs still see the tools, but every call only returns a message asking for the link, so the chat explains the problem instead of reporting no tools. Unlinking an ID whose email matches an enabled account lets it link again on its next request; disable the account to stop it.
- **GPU control:** `CONTROL_MCP_API_KEY` (header-only, distinct from `STUDIO_MCP_API_KEY`) gets only the GPU tools (GPUStatus, Workloads, Preview, Apply, Mode, Restart, Operation) and reaches no galleries or accounts. They drive Studio's own [runtime control](#queue-sessions--runtime-control), so the key needs `STUDIO_KUBERNETES_WORKLOADS`.

MCP's own requests to the studio use a per-process internal credential. It is accepted only from this computer and only for MCP's routes.

### MCP Admin Tools & External Chat

Administrator MCP tools retain their published names and permission boundaries. Library transfers and downloads use the same domain services as HTTP. Administrators can edit and approve runtime-owned catalogue, profile and guide definitions through the retained mutation tools. Personal MCP tokens remain distinct from browser administrator credentials.

The retained external-chat handover contracts use `STUDIO_CHAT_URL`, `chat-handovers.json` and account-owned job relationships. They remain available for existing LibreChat consumers.

Studio's Chat tab uses its own OpenAI-compatible text gateway, configured with three server-side settings:

- `STUDIO_CHAT_GATEWAY_URL`: gateway root, `/v1` base or full `/chat/completions` endpoint.
- `STUDIO_CHAT_GATEWAY_KEY`: gateway credential, never sent to the browser.
- `STUDIO_CHAT_GATEWAY_MODELS`: comma-separated permitted model IDs or prefixes ending in `*`, such as `ai/*,deepseek/specific`. Missing or empty configuration leaves Chat unavailable. Chat only offers models actually returned by this gateway's model catalogue; the first permitted model is the default. Selected models are checked again for every message.

Chat uses the Prompt Assistant account permission; known Spicy models also require NSFW Models. Its gateway is independent of prompt assistance and `STUDIO_CHAT_URL`, which retains its external-chat handover meaning. Chat preserves the selected media model and backend. Explicit requests to create, refine or animate media use the normal generation admission path; discussion alone does not generate media. Editing and submitting a generation card records its changed settings in the conversation, then generates once after the assistant finishes its reply. Each iteration retains the assistant's text, generation inputs, actual text model and linked results; a model without a name of its own (a routing alias such as `ai/text`) is listed under the model that last answered for it. Interrupted text responses retain their partial content, and recorded media actions are not automatically resubmitted.

MCP assistant records survive a restart and preserve who prepared each generation. Results and signed links stay scoped to the owning account. Existing gateway settings remain supported while the separate Bifrost migration is pending.

`STUDIO_ENABLE_GROK=0`, `STUDIO_ENABLE_KROMA=0` and `STUDIO_ENABLE_LORAS=0` disable those optional catalogue features for everyone, administrators included, and reject unavailable generation settings; the matching group features show as locked. All three are enabled by default and Settings no longer switches them. In account mode, a LoRAs or Cloud Models value saved earlier from Settings is carried into every group once (a group keeps a feature only where the switch had it on) and then dropped from Studio's own env file.

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

- `STUDIO_ASSISTANT_MODEL`: the model that rewrites prompts, writes negatives, suggests LoRAs and describes images. Unset, it is `STUDIO_PROMPT_WRITER_MODEL`. MCP Generate keeps `STUDIO_PROMPT_WRITER_MODEL` either way.
- `STUDIO_ASSISTANT_SPICY_MODEL`: an uncensored model for the Spicy preset. Unset, Spicy is hidden and refused.

Configure these in the deployment. The retained administrator integration APIs list gateway models (`GET /v1/models`) and optional vision metadata (`supports_vision` from `GET /model/info`; unknown counts as text-only). The rewritten settings page does not expose integration editing.

The **Prompt Assistant** group feature (an access profile on the server) gates every assistant route. It is on for the built-in groups and for groups stored before it existed; turn it off per group in **Settings › Groups**. Spicy also needs **NSFW Models**. LoRA suggestions need **LoRAs**, and drafting guides and profiles is for administrators. Replies are never logged; logs carry only the operation, profile, timing and a short failure reason. Each call times out (30 s, 90 s when streamed) and falls back: a rewrite returns the original prompt, a negative the guide's default, LoRA suggestions the word-matched candidates. Prompts written for a generation are the queue's [writing stage](#queue-sessions--runtime-control) instead: they never fall back, and their budgets leave room for a reasoning model's thinking.

Each account's **Taste Profile** (Settings › Account; `GET`, `PUT` and `DELETE /api/taste`, `POST /api/taste/refresh`) is a short summary the assistant model keeps from the account's stars, compare votes (the winner is recorded as preferred over each other finished variant, a relative signal rather than a dislike), iterations and Dream keeps and discards, with their prompts, profiles and LoRAs; one action, such as a bulk star, adds at most 20 signals. It is stored in `studio.sqlite` as the `taste:<account id>` document. After every eight new signals Studio rewrites it in the background, at most every ten minutes and never while the text runtime is offline; an edited summary is kept and revised, not replaced. Accounts without **Prompt Assistant** can edit their summary, but nothing is sent to the text model. MCP's automatic model pick and its prompt writer read the summary (at most 500 characters) as context.

**Dream** (`GET /api/dream`, `PUT /api/dream/settings`, `POST /api/dream/:itemId/keep`, `/discard` and `/variations`, `GET /api/dream/discarded`) makes results for an account while Studio is idle, from its taste profile and recent starred prompts. It is off for every account until turned on; the settings (buffer 12 unseen, 40 images and 4 videos a day, videos and Spicy off) are the `dream:<account id>` document in `studio.sqlite`. Dream queues one job at a time across Studio, at the lowest queue tier, only while no person's or MCP's job is queued or running and no text work (a Chat reply or admitted local text) is active; a waiting Dream job is cancelled as soon as other work arrives, and a started one finishes. Dream jobs stay out of the queue list, so Cancel All and Cancel Pending leave them alone; pausing Dream cancels its waiting job. It stops at the unseen buffer and at the day's caps (the server's local day), uses only ready local profiles the account may use (the most-starred in the last 30 days, else the default), and skips while the text model or the kind's worker is offline, logging the reason once. Accounts without **Prompt Assistant** get nothing. Videos animate a kept or starred image. Spicy needs **NSFW Models** and a Spicy model. Results stay out of the gallery, its filters, search, exports and MCP until kept; keep and discard are taste signals, starring an unseen result anywhere keeps it, every discard is kept (with no cap), and Variations keeps the image and queues new seeds as the person's own job.

**Finish Starred Images** (**Settings › Studio**; `GET /api/finishing`, `PUT /api/finishing/settings` with `enabled`, `quality` of `fast`, `balanced` or `high`, and `faceDetail`) smart-upscales the images an account stars while Studio is idle. It is off for every account until turned on; the settings (Balanced quality, Face Detail on) and the waiting list are the `finishing:<account id>` document in `studio.sqlite`. Starring a finished gallery image without an upscale, made or queued, adds it to the list once; unstarring takes it off until its upscale starts, and turning the setting off empties the list. By the captioner's rule (no job of anyone's, Dream's included, queued or running and no text work), Studio queues one list image at a time through the same path as **Upscale**, at the lowest queue tier, on the upscale worker only and never in the cloud, at automatic size; a waiting one is cancelled and put back as soon as other work arrives, and a started one finishes. Face Detail joins only an image whose prompt shows a full-body person (the MCP rule) and only while the worker has the face detector and Impact Pack nodes. While the worker or the SeedVR2 nodes or models are unavailable the list waits and the log says why once. Accounts without **Gallery** cannot use it, and its upscales count towards no job limit.

Dream results load up to two of the account's starred LoRAs that the chosen profile can use, at their saved strength, and the prompt writer is told which. **Calibration** (`GET /api/dream/calibration?limit=`, `POST /api/dream/calibration` with `liked` and `passed` item IDs) mixes the account's own finished gallery images at least a day old into the Dream deck, as single cards and this-or-that pairs, without using the GPU, even while Dream is off. A choice records `calibrate-like` or `calibrate-pass` taste signals and changes nothing in the gallery (Star on a calibration card also stars the image); images not yet judged come first, and the judged item IDs are kept in the `dream:<account id>` document.

**Gallery Captions** (**Settings › Models**, `STUDIO_GALLERY_CAPTIONS`, on by default; `0` turns them off) let gallery search match what an image shows as well as its prompt. While Studio is idle, by the same rule as Dream (Dream's own jobs count as work here), the assistant model describes finished images, newest first, from a copy of at most 512 px. It sees only the image, never the prompt, and is asked for visible facts: subjects and objects; people's apparent age range, body type, hair, skin tone and apparent ethnicity, clothing and nudity, pose and expression; the setting; actions; the medium, lighting, colours, mood and framing; and legible text verbatim, with no judgement or guessed names. The reply is JSON with the text and 8–15 lowercase tags; a plain-text reply is kept without tags. The caption (`caption` on the gallery record: `text` up to 600 characters, up to 15 `tags`, `model`, `at` and the format `version`) is searched with its tags. Normally new images are captioned one at a time, at most one every 10 seconds and 500 a day (the count is kept in `studio.sqlite`). **Settings › Maintenance › Caption Gallery** (administrators; `GET /api/gallery/captions`, `POST /api/gallery/captions/start` and `/stop`) runs a pass instead: two at a time with no spacing or daily cap until every image has a caption in the current format (older captions are redone) or it is stopped, showing done of total, failures, the rate and the time left. The pass is the `captions` document in `studio.sqlite`, so a restart resumes a running pass and reports a stopped or finished one. Both yield as soon as other work arrives and try those images again later. An image that fails is skipped until the next start; three failures in a row pause captioning for a minute instead. Captions need a model that reads images (`supports_vision`); with a text-only model they are skipped and the log says so once. Accounts without **Prompt Assistant** are never captioned, and there is no cloud fallback.

**Suggestions** (`POST /api/suggestions` with `surface` `composer`, `viewer` or `chat`) ask the assistant model for three prompt ideas from the taste profile and liked prompts, three or four next steps for a finished image from its prompt and settings, or a paragraph of taste context. Answers are cached per account and input for ten minutes. Accounts without **Prompt Assistant**, or while the text runtime is offline, get an empty list with the reason; there is no fallback text and no cloud model. Chat's assistant also receives the account's taste summary as context.

`mise run eval:assistant` replays the recorded cases in `backend/fixtures/assistant-evals/` against the live gateway, using the variables above, and scores them; `--record` writes the live replies back for review. CI only scores the recorded replies.

## Profiles, Guides & Catalogue

Studio owns editable live definitions in its data directory: profiles in `workflows/`, prompting guides in `guides/`, and catalogue changes in `library/`. Administrators edit and approve these in Library; user presets remain account-owned runtime data. Existing identifiers are preserved; each profile maps its controls in its `studio` block.

`STUDIO_CONFIG_DIR` is a read-only ai mount for initial seed definitions. Its seed layout is:

```text
profiles/*.json
lora-catalogue.json
models.json
profile-aliases.json
prompting.json
```

`STUDIO_SEED_DIR` can explicitly select a seed/export directory. Startup fills only missing files and definitions, preserving existing runtime edits and deleted-profile history. It never writes back to ai or synchronises over live definitions. Export through the retained administrator API to update the ai backup after review.

Settings › Profiles › Merge Duplicate Profiles is an explicit administrator action, never run at startup. It previews profiles with the same name and kind whose graph (node titles aside), profile block (apart from id, name and description), guide binding, negatives and AI-Drafted state are identical, keeps the id that follows `<kind>-…-<backend>` and lists same-named profiles that differ or have no single id to keep. Applying copies the removed files and the previous aliases and workflow preferences to `backups/profile-merges/<time>/`, records each removed id in `workflows/.studio-aliases.json` and removes its file; its version history stays. Records that name an old id (gallery items, presets, jobs, Chats, MCP calls, access grants, taste signals) are left as they are and resolve to the kept profile. Exports carry the aliases as `profile-aliases.json`, and seeding adds aliases the data folder lacks before profiles, so a merged id is never seeded back.

### Profile Backends

A profile can run one model on Radiance or ComfyUI. Its `studio` block then holds the shared fields (`id`, `name`, `kind`, `family`, `nsfw`, `prompting`; the guide binding and negatives follow the profile id), the backend it runs on and each backend's own block with its graph:

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

Settings › Profiles › Combine Backends is an explicit administrator action, never run at startup. It previews pairs of one model's profiles (the same kind, family and name before its first `·`), one running Radiance nodes and one ComfyUI's, with what differs (steps, size, references, modes, LoRAs, guide and negative prompt). The administrator picks pairs, each one's name and default backend; a profile joins one pair at most. Applying refuses a stale preview, copies both files, the aliases, workflow preferences, `guides/prompting.json` and `timings.json` to `backups/profile-backends/<time>/`, writes the combined profile as a new profile (its id is the ComfyUI id without `-comfyui`) with the default backend's guide binding and negatives, records both old ids in `workflows/.studio-aliases.json` as `{"to": "<combined id>", "backend": "<its backend>"}`, removes their files (their version history stays) and moves their run timings to the combined profile's backends. An old id in a record, a generation request or an MCP call runs on that id's backend (Exact Repeat, Recreate and Reuse included); records themselves are not rewritten. Applying again does nothing; an apply that stopped part way finishes. Exports carry the aliases with their backends, so a seed never brings the old ids back.

## SQLite Migration & Rollback

Native Node SQLite stores the persistent queue, sessions, Chat messages and user presets in `studio.sqlite`. Accounts, account sessions, gallery metadata and deletion markers move into its document tables through an explicit offline migration. Until that migration commits, the retained JSON stores remain authoritative. The same command then renames the [names Studio kept on disk](#studio-names) from HEISS UI.

Stop Studio and run a dry run against a copy of the intended data directory:

```sh
node backend/commands/migrate-runtime.mjs --data-dir /copy/of/studio-data
node backend/commands/migrate-runtime.mjs --data-dir /copy/of/studio-data --apply
```

The dry run reports source-to-table mappings, record counts, hashes and conflicts without creating a database, and the [renames](#studio-names) it would make. Apply verifies copies of affected metadata and a restore manifest under `.backups/sqlite-*` before committing all documents and its migration marker atomically. The source JSON remains untouched. Re-running never reimports stale JSON over SQLite. Protect the complete original data directory and media separately before production migration; the metadata backup covers only files this migration changes authority for.

Rehearse restoration into a separate empty directory:

```sh
node backend/commands/migrate-runtime.mjs --restore /copy/of/studio-data/.backups/sqlite-STAMP --destination /empty/restore-rehearsal
```

Verify account ownership, profile identifiers and existing result links on the copy. For rollback, stop the rewrite, retain its complete SQLite/media state, put the old names back with `--undo` (see [Studio Names](#studio-names)), restore the verified pre-migration metadata beside the media, then start the previous application image. Do not run old and new writers against the same data directory. Post-migration work must be retained or explicitly mapped before reverting to the older JSON-only application.

Development uses `data/development` with SQLite migration applied only to that isolated directory. Recovery follows recorded job IDs and never scans or adopts a shared worker's full history.

## Queue, Sessions & Runtime Control

`/api/sessions` stores generation inputs and result relationships; `/api/queue` exposes writing, queued, waiting, starting, running, saving, completed, failed and cancelled operations.

**Writing** is the first stage of a generation whose prompt the prompt assistant writes: the viewer's Animate themes, MCP Generate and Reuse when Studio writes the prompt from the request, and Dream. One click or call queues the job; it writes its prompt, then queues for its worker, with no review pause. The thinking (`reasoning_content` and `<think>` blocks) and the prompt stream into the queue item, and the result keeps the written prompt with its text model and thinking, collapsed under the prompt in Details. The shared text model writes at most two prompts at once, higher queue tiers first and then in order; the rest wait in their writing stage. A failed write fails the item with the reason (Retry writes it again); cancelling stops the writing; a restart writes it afresh. MCP's status and replies leave the thinking out. Users can cancel their pending jobs and retry failed jobs. Recorded provider jobs are recovered before any resubmission. Ambiguous submission outcomes stay visible for investigation rather than creating duplicate generations.

Work waits for the selected worker by default. Independent resources can run concurrently. A worker's admission remains held until results are safely saved; text admission remains held until its response stream drains. Runtime status is administrator-only.

Studio switches the GPU workloads itself: each is a Kubernetes deployment it scales between 0 and 1 replicas. `STUDIO_KUBERNETES_GPUS` gives the GPUs per node pool and `STUDIO_KUBERNETES_WORKLOADS` the deployments, keyed by a stable workload id:

```bash
STUDIO_KUBERNETES_GPUS='{"gpu": 2, "gaming": 1}'
STUDIO_KUBERNETES_WORKLOADS='{
  "comfyui": {"kind": "image", "label": "Image", "namespace": "comfyui", "deployment": "comfyui", "pool": "gpu", "gpus": 1, "url": "http://comfyui.comfyui.svc.cluster.local:8188"},
  "comfyui-video-tp2": {"kind": "video", "label": "Video · 2 GPUs", "namespace": "comfyui-video", "deployment": "comfyui-video-tp2", "pool": "gpu", "gpus": 2, "url": "http://comfyui-video.comfyui-video.svc.cluster.local:8188"},
  "text-qwen-mxfp4": {"kind": "text", "label": "Qwen MXFP4", "namespace": "text", "deployment": "text-qwen-mxfp4", "pool": "gpu", "gpus": 1, "url": "http://qwen-mxfp4.text.svc.cluster.local:8000", "apiKeyEnv": "STUDIO_TEXT_KEY"}
}'
```

`kind` is `image`, `video` or `text`; `url` is the workload's direct address (media workloads match their worker by it, and several deployments may share one); text workloads name the variable holding their Radiance key in `apiKeyEnv`. A malformed value stops Studio at start with the reason. Studio uses its pod's service account, which needs a role in each workload namespace to read deployments and pods and to update `deployments/scale`; `STUDIO_KUBERNETES_URL` (such as `kubectl proxy`) replaces it for local development.

**Settings › Workers** shows each workload's state, GPU use and why a pod is not ready (such as a GPU claim that cannot be allocated). An administrator ticks the workloads that should run and reviews a preview before applying it; every workload left out stops. Restart scales a running workload to 0 and back. One change runs at a time: Studio stops accepting new work on the workloads that leave, waits for their accepted work to finish and save, scales them to 0, waits for their pods to go (their GPU claims are released only then), then starts the others and waits for them to be ready. Each change is recorded with its requester, timestamps, steps and the placement before and after, and the history survives restarts; a change cut short by a restart is marked interrupted. A deployment stopped outside Studio, such as by a Flux upgrade that resets replicas, shows as changed outside Studio.

Automatic control (`STUDIO_RUNTIME_AUTOMATIC=1`, off by default) starts and stops only media (image and video) workloads. Queued work for a stopped media workload starts it, stopping the media workloads in its pool it needs room from (idle ones first), and waits with "Waiting for <workload> to start". It never stops or starts a text workload, because LibreChat and Bifrost call text models directly and Studio cannot see those requests: if a running text workload holds the GPUs the media workload needs, nothing changes and the work waits with "Waiting for a GPU: <text workload> is running; stop it in Settings › Workers". A stopped text workload is started in Settings › Workers or with the control MCP tools, which may stop text as an explicit choice. After an outside stop Studio restores its last applied placement, keeping any running text; while that text holds GPUs the placement needs, the restore waits. Without automatic control, work for a stopped workload waits with the reason that the worker is offline. Text admission credentials stay on the server; see [worker operations](worker/README.md).

Bifrost remains a separate text gateway. It calls `/api/local-text/v1/chat/completions` for managed local text; that endpoint calls Radiance directly. Live Bifrost verification and the separate LiteLLM migration remain pending. Existing assistant gateway settings continue to work during that migration.

## Hidden Removal

Studio no longer has Hidden. The first start of a version without it backs up and converts what an older Hidden left in the data folder, once, and deletes nothing:

- **The backup** goes to `<STUDIO_DATA_DIR>/backups/hidden-removal-<time>/` (readable by the server's user only). It holds copies of `gallery.json`, `gallery-hidden.json`, `privacy.json` and `hidden-runs.json` where they existed, the encrypted `.private-vault` folder moved in whole, and a `summary.json` and `README.txt` saying what changed. The backup is written even on a studio that never used Hidden, so a deployment can confirm the step ran.
- **Into the gallery:** gallery records still flagged as Hidden become ordinary gallery items, and records that a delete marker in `gallery-hidden.json` kept out of view come back. Markers for deleted and cleared outputs stay, so those don't return from ComfyUI's history.
- **Still encrypted:** images inside the vault can't be opened without the owner's Hidden password, so they stay as ciphertext in the backup. `summary.json` counts them, and the server log warns once. Prompts sealed by the older scheme are cleared from the gallery records; the backup's copy of `gallery.json` keeps them.

`<STUDIO_DATA_DIR>/.hidden-removed-v1` records that the step finished. Remove it only to run the step again.

## Renamed Settings

Studio 1.0 reads only Studio names: every Studio setting starts with `STUDIO_`, and no old name is read as an alias. Third-party credentials keep their standard names (`HF_TOKEN`, `CIVITAI_API_TOKEN`). Rename these before upgrading:

- Each `HEISS_*` setting is now `STUDIO_*` with the same suffix, such as `HEISS_DATA_DIR` → `STUDIO_DATA_DIR`.
- `MCP_SIGNING_KEY`, `MCP_PUBLIC_URL`, `MCP_PROMPTING_PATH`, `COMFY_OUTPUT_DIR`, `COMFY_INPUT_DIR`, `BIFROST_URL` and `CIVITAI_DNS_SERVERS` gain the prefix: `STUDIO_MCP_SIGNING_KEY`, `STUDIO_MCP_PUBLIC_URL`, `STUDIO_MCP_PROMPTING_PATH`, `STUDIO_COMFY_OUTPUT_DIR`, `STUDIO_COMFY_INPUT_DIR`, `STUDIO_BIFROST_URL` and `STUDIO_CIVITAI_DNS_SERVERS`.
- `COMFY_URL` and `COMFY_VIDEO_URL` are gone: list the workers in `STUDIO_WORKERS` (keep the ids `primary` and `video` so earlier jobs keep their worker) or add them in Settings › Workers. `STUDIO_DEFAULT_COMFY_URL` and `STUDIO_COMFY_SEARCH` are gone too; Studio no longer looks for ComfyUI by itself.
- Scripts send the `X-Studio` header; `X-HEISS` is refused.

Browser storage and the account cookie (`studio_account`) already used Studio names.

## Studio Names

Studio 1.0 keeps no names on disk from HEISS UI. The [runtime migration](#sqlite-migration--rollback) renames them once, after its SQLite import, with Studio stopped. Studio 1.0 reads only the Studio names, so run it on existing data before 1.0 starts.

| Old name                                                             | Studio name                         | Where                                                                                                                                                                                |
| -------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `heiss-ui/` (and `heiss-ui/accounts/<hash>/`)                        | `studio/`                           | Studio media (`--media-dir`, by default `<data>/media`) and, with `--output-dir`, ComfyUI's output folder                                                                            |
| `.heiss-trash/` (and each batch's `files/heiss-ui/`)                 | `.studio-trash/`                    | The same folders                                                                                                                                                                     |
| `heiss-ui` in `subfolder`, `/comfy/view` and thumbnail URLs          | `studio`                            | Every database row (gallery, deletion markers, sessions, queue, jobs, Dream, taste), the JSON stores in the data folder (reference assets, Library, account files) and trash batches |
| `heissUi` profile block (and `heiss_ui`, `jAiStudio`, `j_ai_studio`) | `studio`                            | `workflows/*.json` and their versions in `history/profiles/`, with output prefixes and the version hashes in `.studio-meta.json` and `.studio-edits.json`                            |
| `heiss-*.log`                                                        | Deleted (a copy goes in the backup) | `logs/`                                                                                                                                                                              |

Deletion markers of renamed gallery records move to their new keys. Backups (`backups/`, `.backups/`, `imports/`) and the JSON the SQLite import read stay as they are. The thumbnail and video preview caches are keyed by path, so they are made again as the gallery is viewed.

1. **Back up.** Stop Studio (scale it to zero), then snapshot the data volume (`/data`, on kimbap's `truenas-nvme/studio` dataset). Keep the snapshot until the migrated studio has run for a while.
2. **Dry run (default).** It changes nothing and reports, per mapping: the folders it renames, the files it rewrites by kind, the database rows by table or document (gallery records per account), the deletion markers it moves and the old logs. `missingFiles` lists finished gallery records whose file is not where the record says, and `outsideMedia` counts those in ComfyUI's output folder, which are only checked with `--output-dir`. Conflicts refuse the apply: a target folder that already exists, a profile with more than one block, or an unreadable file.
3. **Apply (`--apply`).** It first writes `.backups/names-<time>/` and flushes it to disk: `manifest.json`, a copy of every file it rewrites or deletes, and `rows.json` with each changed row's previous value. Then it replaces each file whole, renames each folder (one rename on the same file system, so nothing is copied), updates the database rows and records `studio-names-v1` in one transaction, and deletes the old logs. A second run does nothing.
4. **Recovery.** `--undo <data>/.backups/names-<time>` renames the folders back, restores the files and rows, returns the logs and removes the record, also after an interrupted apply. It does not keep work saved after the apply, so undo only before Studio 1.0 has run; after that, restore the snapshot from step 1 and redeploy the previous image.

```sh
node backend/commands/migrate-runtime.mjs --undo /data/.backups/names-STAMP
```

What Studio writes uses the Studio names too: `studio-reference-*` and `studio-upscale-*` in ComfyUI's input folder, `studio_generation` run records, `studio_*` sections and `.studio-backup` copies of ComfyUI's `extra_model_paths.yaml` in single-user mode (Studio finds the sections it added by their comment markers, so older ones keep their keys), and a `civitai` metadata chunk in imported PNGs. ComfyUI's own `<output>/heiss-ui` folder from older runs is not read.

The profile block is shared with the seeds in ai's `profiles/`, which switch to `studio` in the same cutover window.

The one name left is the key derivation label `heiss-mcp-result-link-v2` that seals MCP result links: every link already shared depends on it.
