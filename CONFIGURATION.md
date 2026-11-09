# Configuration

Set different ports or paths in `.env` in the project folder, such as:

```bash
HOST=127.0.0.1
PORT=8787
STUDIO_DATA_DIR=./data
```

Single-user mode answers only the computer running Studio; other devices need [account mode](#multi-user-mode). `STUDIO_ALLOWED_HOSTS` lists extra names to answer to (comma-separated); TLS terminates at the proxy in front of Studio. See [Security](./SECURITY.md) and [Accounts & Devices](./TROUBLESHOOTING.md#accounts--devices).

Studio never reads ComfyUI's folders: outputs come into [Studio media storage](#studio-media-storage-comfyui-as-a-worker) and models live on the worker, so workers need no shared storage. See [Workers](#workers) for one or many ComfyUI workers.

## Workers

Studio runs on zero, one or many ComfyUI workers. Each has a stable id, a name,
an address and what it can do:

| Capability | Runs                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `image`    | Image generation                                                                                              |
| `video`    | Local video generation                                                                                        |
| `upscale`  | Upscaling finished images and videos; Smart upscale inside a run needs it on the worker running the image too |
| `models`   | Holds the model library and receives model and LoRA downloads                                                 |

The deployment defines the workers; Studio does not edit them:

```bash
STUDIO_WORKERS='[
  {"id": "primary", "name": "Primary", "url": "http://comfyui-primary:8188", "capabilities": ["image", "video", "upscale", "models"]},
  {"id": "secondary", "name": "Secondary", "url": "http://comfyui-secondary:8188", "capabilities": ["image", "video", "upscale"]}
]'
```

`id` is optional (it defaults to the name in lower case) but keep it stable:
jobs, previews, cancellation and recovery after a restart follow a job's
worker by id. `STUDIO_WORKERS='[]'` runs Studio with no workers: it says so
plainly and refuses generation. A malformed value stops Studio at start with
the reason. **Settings › Workers** lists every worker read-only for
administrators, with where it comes from (`GET /api/workers`) and its health
and work: whether a job runs there, how many wait for it, the profile it last
ran, its free GPU memory and when it should be free. The control key's
`gpu_status` tool returns the same list.

On Kubernetes, leave `STUDIO_WORKERS` unset: the image and video
[workloads](#queue-sessions--runtime-control) Studio finds are the workers, one
per address. When `STUDIO_WORKERS` is set, it lists the workers
instead. Without either, Studio starts with no workers.

**Routing:** the Worker setting defaults to Automatic, which queues work on an online worker that runs it: one that has the profile, then a free one, then one that last ran the same model, then the one with the fewest queued jobs, then list order (the first for manual work, the last for MCP, Dream and finishing work, keeping the first free for manual work). Until it starts, Automatic work waiting behind busy work moves to an idle worker that runs its profile, preferring one that last ran the same model, manual work first; a queued job on an idle worker moves only to another idle worker that last ran its model. Background work moves only while no manual work waits. A worker that stops, restarts or goes offline counts as having nothing loaded. One local video runs at a time across all workers, because two at once on one-GPU workers sharing a node run it out of system memory: a second video waits with "Waiting for another video to finish" while images and cloud videos still run beside it (a two-GPU worker holds its node alone, so the rule never holds it back). A picked worker is strict: the job waits for it, also while it is offline, unless the user permits fallback to another worker advertising the same profile. Studio never substitutes an unavailable model or switches to a cloud provider implicitly, except for [Animate](#cloud-models), which never waits on a stopped video worker. Worker capability checks apply before submission. Which GPU workloads run is [runtime control](#queue-sessions--runtime-control).

## Cloud Models

Set `STUDIO_CLIPROXYAPI_URL` to the CLIProxyAPI base URL and `STUDIO_CLIPROXYAPI_KEY` to its server-side credential; Studio calls it directly, never through a ComfyUI worker. A cloud profile is a workflow whose every mode is one `GrokMedia` node, and it is listed only while the provider advertises its model. `STUDIO_CLIPROXYAPI_IMAGE_MODEL` and `STUDIO_CLIPROXYAPI_VIDEO_MODEL` pick the model for a profile that names none; otherwise the first advertised one is used. A workflow that mixes `GrokMedia` with other nodes runs nowhere.

Direct cloud work is independent of GPU admission. Studio records asynchronous video request IDs and recovers them before resubmitting. A synchronous image request has no resumable provider ID: an interrupted response remains visible as unknown and is never retried automatically. Cancelling that operation ends Studio's wait; the provider may still finish or charge for work already accepted. Saved results retain the actual provider/model and the existing media result-link shape.

Cloud Models and uncensored access remain per-user permissions. Credentials never reach the browser or media-download URLs.

**Animate** runs where the account prefers videos to run: Cloud (a Grok video
profile, with Cloud Models), or the local Fast or Quality tier of its
first-frame video profiles, preferring its default family. Unsaved, the
preference is Fast where the account has local video, otherwise Cloud. When the
preferred side can't run (the local video worker is stopped, or the account has
no Grok profile), Animate runs on the other and says so. It shows the choice before queuing; Chat and MCP replies name it too.
With neither available, nothing queues. An explicitly chosen profile always
wins. Output follows the source image's proportions at the profile's default
size, constrained to provider-supported aspects. Themes write a motion prompt
from the visible image and its context; on a video they continue the action
from its last frame, keeping the video's model unless videos run on Cloud.
Animate's menus set the preference (the `videos` account preference). MCP
`reuse` takes `runs_on` and `tier` instead, and a `runs_on` never falls back.
Review Prompt First shows the model and lets you edit the written prompt before Run;
Custom prompts and Animate in Composer remain available.

Other MCP video follows the same rule while the local video worker is off: it goes to a cloud profile the account is granted and the reply says so, or, with none granted, is refused with the reason. Studio's own composer and held video work never switch to the cloud.

## Model Manifest

The worker with the `models` capability (see [Workers](#workers)) holds the model
inventory and receives downloads. Set the same nonempty `STUDIO_WORKER_TOKEN` on
both services and mount the worker's models read-write. Provider credentials
remain in Studio; downloads stream directly to the worker and resume against
their recorded source, size and SHA-256 checksum. See
[Studio Worker Node](worker/comfyui/studio_worker/README.md).

`<STUDIO_DATA_DIR>/config/models.json` is the pinned list of the models a deployment expects: a JSON array of `{ "path", "sha256", "size", "url"? }` entries. Each `path` is relative to ComfyUI's model folder; when the manifest's paths start with a deployment folder instead (such as `models/comfyui/`), set `STUDIO_MODEL_MANIFEST_PREFIX` to strip it.

The catalogue reads the manifest's hashes, sizes and links. Administrators manage model downloads in **Library › Downloads**. Downloads verify their recorded checksums and retain explicit filename conflicts.

## Studio Media Storage (ComfyUI as a Worker)

Studio keeps every finished output in its own folder and treats ComfyUI as a stateless worker:

- Studio fetches each output over ComfyUI's HTTP API into `STUDIO_MEDIA_DIR` (`<STUDIO_DATA_DIR>/media` by default), with a folder per account.
- The [Studio worker node](worker/comfyui/studio_worker/README.md) then removes ComfyUI's copy, the run's staged inputs and its history entry.
- Studio and ComfyUI no longer need to share a folder, so they can run on different servers.

Set the same `STUDIO_WORKER_TOKEN` in Studio and ComfyUI to protect the worker node's endpoints.

Existing ComfyUI outputs stay where they are; only new runs, upscales and recovered runs move. If an output cannot be fetched, it keeps its ComfyUI address instead of being lost. Without the worker node, ComfyUI keeps its copies and Studio logs a warning.

## Multi-User Mode

`STUDIO_MULTI_USER=1` turns on optional accounts. It is off by default; single-user mode and device sign-in behave as before.

- **Every request needs an account,** including requests from this computer. The first visit on the computer running Studio creates the recovery administrator; after that, administrators add accounts in **Settings › Users**. Accounts sign in with their email address, which is the account's username; accounts created before this with other usernames keep signing in with them.
- **Single sign-on (Pocket ID or another OpenID Connect provider):** set `STUDIO_OIDC_ISSUER`, `STUDIO_OIDC_CLIENT_ID` and `STUDIO_OIDC_REDIRECT_URI` (`https://<studio>/api/accounts/oidc/callback`). Public PKCE clients need no secret; `STUDIO_OIDC_CLIENT_SECRET` supports confidential clients, and `STUDIO_OIDC_LABEL` names the button (Single Sign-On by default). Once it is set up, visiting Studio signed out goes straight to the provider; a failed or declined sign-in, or Sign Out, shows the sign-in form with the reason instead of sending you back, and `/?password=1` opens the form for the recovery administrator and accounts with a password. Setting only some of these stops Studio at startup and names the missing ones. The provider decides who may sign in. A verified email that matches an ordinary account's username links that account, unless the account changed its email itself in **Settings › Account**; any other identity becomes a new account on the default group at once. Roles and groups never come from the provider.
- **Probes stay open:** `/api/ping` (liveness) and `/api/ready` (readiness: the data folder is writable) answer without an account. ComfyUI workers being down does not make Studio unready.
- **Administrators** have full access by role. **Ordinary accounts** belong to one
  group granting local generation profiles and the Chat, Cloud Models, Dream,
  LoRAs, Prompt Assistant and Uncensored Models features. All includes future
  local profiles; otherwise new profiles need an explicit grant. Uncensored
  profiles also need Uncensored Models. Chat, Dream and Prompt Assistant remain
  enabled for older groups unless disabled. Prompt Assistant covers rewrites,
  suggestions, prompt ideas and written Animate themes; turning it off still
  permits typed generation prompts. Image/video generation, references, gallery,
  prompt history and upscaling are available to every account. Presets and
  Civitai imports remain administrator-only. Account preferences may narrow
  granted features everywhere without restricting an administrator's catalogue
  management.
- **Default group:** Studio adds a User group (all local models except uncensored ones; no cloud models or LoRAs) when no group has that ID, makes it the default when none is set, and removes the Administrator group earlier versions added unless it has members or is the default. Administrators edit groups in **Settings › Groups** and pick the default group under **Settings › Users › Default Group**; every new ordinary account starts on it: those added in **Settings › Users**, first single sign-on and chat gateway accounts.
- **Administrators manage accounts** in **Settings › Users** (`PATCH /api/accounts/users/:id` with one of `accessProfileId`, `disabled`, `role` or `password`; `DELETE` to delete): Make Administrator or Make User (a new user joins the default group), Reset Password for an account that signs in with one (at least 8 characters, typed or generated and shown once; it ends the account's sessions), Disable, Delete Gallery and Delete. Delete Gallery (`DELETE /api/gallery/owners/:id`; `GET /api/gallery/owners` counts each account's items) deletes all of the account's visible gallery items and their files, as the owner's own delete does. Deleting the account removes the record with its sessions, MCP token, chat gateway links and preferences; its gallery files and other saved records stay in the data folder, owned by nobody who can sign in. Single sign-on and the chat gateway refuse the deleted account's email and sign-on identity instead of making a new account, until an administrator adds an account with that email again. Nobody changes their own role, disables or deletes themselves, and the last enabled administrator stays one. **Settings › Groups** deletes a group only while nobody belongs to it and it isn't the default (`DELETE /api/accounts/profiles/:id`).
- **Each account's outputs, prompt history, LoRA stacks, references and jobs are private** and saved under its own output subfolder. Ordinary accounts only reach reviewed, owner-checked routes; studio administration (models, connection, updates, presets, trash) stays with administrators. Run grouping is unavailable to accounts.
- **Personal MCP tokens** are issued once in Settings, stored only as hashes, and work only for MCP. Only an administrator's own token reaches the MCP admin tools; no token is a browser administrator credential. Rotating or revoking a token leaves existing result links working; a result link ends when its output is hidden or deleted.
- **Records from single-user mode have no owner** and stay out of every account's gallery until they are explicitly migrated to an account.

Session cookies are marked `Secure` over HTTPS, including behind a proxy that sends `X-Forwarded-Proto: https`.

MCP clients connect in one of three ways in multi-user mode:

- **Personal token:** a client sends the account's own token as `Authorization: Bearer <token>` to `/mcp`. A client that can send no headers, such as a Grok custom connector, uses `/mcp/<token>` as its complete URL. Only a personal token works in the path; the shared gateway and control keys are header-only. URLs can reach proxy logs and browser history, so mint a token for that one client and revoke it if it leaks. Studio has no OAuth (discovery gets a plain 404), and the MCP endpoints answer a browser's CORS preflight so a connector can validate its URL from a page.
- **Trusted gateway:** a chat gateway such as Bifrost sends the shared `STUDIO_MCP_API_KEY` together with its own user ID in `x-ai-user-id`. Studio acts for that user only once the ID is linked to an account. When the gateway also forwards the user's email in `x-ai-user-email` and it matches an enabled ordinary account's username (ignoring case), Studio links the ID to that account on its first request, recorded like an administrator's link; an unknown email creates an account on the default group and links it. Administrators, and accounts that changed their email themselves, are linked only by an administrator. Otherwise an administrator links the ID under **Settings › Users › Chat Gateway**, where unlinked IDs are listed; **Dismiss** removes one from the list until the gateway sends it again. Unlinked IDs still see the tools, but every call only returns a message asking for the link, so the chat explains the problem instead of reporting no tools. A linked account's row in **Settings › Users** carries a Chat Gateway badge and its ⋯ menu unlinks the ID. Its **Admin Tools** switch there gives linked administrators the admin tools through the gateway; while it is off, only an administrator's personal token gets them. Unlinking an ID whose email matches an enabled account lets it link again on its next request; disable the account to stop it.
- **GPU control:** `CONTROL_MCP_API_KEY` (header-only, distinct from `STUDIO_MCP_API_KEY`) gets only the GPU tools (`gpu_status`, `workloads`, `preview`, `apply`, `mode`, `restart`, `operation`) and reaches no galleries or accounts. They drive Studio's own [runtime control](#queue-sessions--runtime-control), so the key needs `STUDIO_KUBERNETES_NAMESPACES`.

The host in `STUDIO_MCP_PUBLIC_URL` is the internet-facing one: requests to it take only personal tokens, even when `STUDIO_ALLOWED_HOSTS` also lists it. The shared gateway and control keys work only on the other allowed hosts, such as the in-cluster service name, and on the public host get the same 401 as a wrong credential. Signed result, upload and export links are unaffected.

MCP's own requests to the studio use a per-process internal credential. It is accepted only from this computer and only for MCP's routes.

### MCP Admin Tools & External Chat

Administrator MCP tools retain their published names and permission boundaries. Library transfers and downloads use the same domain services as HTTP. Administrators can edit and approve runtime-owned catalogue, profile and guide definitions through the retained mutation tools, and manage accounts and groups with the `accounts` tool (list, save, set the default or delete an empty non-default group, move an account, disable it, change its role or delete it; passwords are reset only in Settings). Personal MCP tokens remain distinct from browser administrator credentials.

#### MCP & UI Parity

Every MCP action calls the route its UI action calls, with the caller's own credential, so ownership, group features and administrator checks apply as in the app. Media tools work on the caller's own results only: a ref or job ID another MCP identity holds is refused before any request. Result numbers ("result 3"), `result` with `all`, `handover` and the All Results page cover one chat: the conversation the client names in `x-studio-conversation-id` (LibreChat), else the MCP session id Studio hands out on `initialize` and the client resends (a Grok connector), else the whole account. `search` and `queue` cover the account's whole gallery and queue.

| UI action                                                                       | MCP tool and action                                                        |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Composer generation, variations, sizes, LoRAs, references                       | `generate` (`models` to look up), `upload`, `upload_link`                  |
| Edit › Run Again and Repeat Exactly, Animate, Extend, Use as Reference          | `reuse` `again` (`preserve_seed`), `animate`, `extend`, `reference`        |
| Upscale                                                                         | `reuse` `upscale`                                                          |
| Compare models side by side                                                     | `generate` with several profiles (a comparison page)                       |
| Gallery search, Starred, uploads                                                | `search`                                                                   |
| Star, unstar, delete, bulk delete, clear failed                                 | `gallery` `star`, `unstar`, `delete`, `clear_failed`                       |
| Status, Stop                                                                    | `status`, `result`, `cancel`                                               |
| Queue pause, resume, cancel all, clear failed, retry, clear, reorder            | `queue`                                                                    |
| Dream keep, discard, more, variations, pair answers, settings, discarded        | `dream` (Dream feature)                                                    |
| Taste profile avoids, refresh, reset; LoRA thumbs up and down                   | `taste` (`rate_lora` needs LoRAs)                                          |
| Prompt assistant presets, negatives, LoRA suggestions                           | `rewrite_prompt`, `suggest_negative`, `suggest_loras`                      |
| Library browse and update view; catalogue edits, undo, remove                   | `library`, `catalogue_edit` (administrators, as for every row below)       |
| Library › Import: Civitai, Hugging Face, Reddit, images; history, clear, remove | `lookup` (search by `type`, `base_model`), `import` (`install`), `imports` |
| Downloads start, retry, cancel; updates check, apply                            | `downloads`, `updates` (`query` names entries)                             |
| Profiles and guides: edit, draft, approve, revert, remove; bindings; export     | `profiles`, `profile_edit`, `export`, `placement`                          |
| Combine Backends, Merge Duplicate Profiles                                      | `combine_backends`, `maintenance` `duplicates`, `merge_duplicates`         |
| Unfinished Items, Pause All; runtime migrations (no UI)                         | `maintenance`                                                              |
| Users and Groups                                                                | `accounts`                                                                 |
| Settings › Workers, GPU placement, restarts                                     | The control key's GPU tools only                                           |

UI-only by design: signing in, passwords, email, MCP tokens, single sign-on and Chat Gateway links (credentials stay in the browser); workflow imports, raw ComfyUI and diagnostics (see [Security](SECURITY.md)); downloads, exports, sharing and GIFs (files for a browser; chats get result links); mask painting and viewer zoom (pointer work). Not in MCP yet: prompt history, personal presets, saved LoRA stacks, reference management, Preferences, comparison votes, video edits and the instance settings in Settings › Generation and Integrations.

Studio's Chat tab uses the assistant's text gateway (`STUDIO_ASSISTANT_URL` and `STUDIO_ASSISTANT_KEY`, below) with its own model list:

- `STUDIO_CHAT_MODELS`: comma-separated permitted model IDs or prefixes ending in `*`, such as `local/auto,cloud/*`. Missing or empty configuration leaves Chat unavailable. Chat offers the models this gateway's catalogue returns, plus permitted models of Studio's text workloads while they are stopped (the gateway lists only running ones); the first permitted model is the default. Selected models are checked again for every message.

Chat follows the group's Chat feature. Its gateway is independent of prompt assistance. Chat is an agent over Studio's own MCP server, run in process: the same instructions, tools (all but `upload` and `upload_link`, since Chat attaches its references itself), prompting guides sent once per chat, model and LoRA choice and admin-tool rule as an MCP client such as LibreChat gets, so both behave alike. Each reply runs on the server, surviving a hidden page or dropped connection, for up to eight model calls: it looks things up, calls tools, reads their answers and continues, then answers in words; the tools it called stay under the reply as its trail. Its work joins the chat as the person's own queue work, one job per image; results already in the chat are named to it by ref ("result 1") and its attached references by ID, and the composer's selection is only a fallback for what the request leaves open. Attached images reach the text model only when it reads images (a text workload marked `vision`, or a cloud model). Earlier replies' tool calls and answers, and failed replies with their reason, stay in its context. Editing and submitting a generation card records its changed settings in the conversation, then generates once, exactly as submitted, after the assistant finishes its reply. Each iteration retains the assistant's text, actual text model and linked results; a model the gateway names only by its ID is listed by a name read from it (`local/auto` as Local · Auto, `cloud/glm-flash-uncensored` as Cloud · GLM Flash Uncensored), and a routing alias such as `local/auto` under the model that last answered for it, in its group (Local · Qwen3.6 27B). Interrupted text responses retain their partial content, and recorded media actions are not automatically resubmitted. Without an MCP key or accounts, `/mcp` is not served but Chat still runs the tools.

MCP assistant records survive a restart and preserve who prepared each generation. Results and signed links stay scoped to the owning account.

Values an administrator saves in **Settings › Generation** (default profiles, the [Background AI](#prompt-assistant) switches, Run While Busy) and **Settings › Integrations** (the assistant model) live in the `settings` document in `studio.sqlite` and apply at once; Studio never writes an env file. The environment wins: a value set there (the deployment, the shell, or the `.env` Studio reads at start, which the shell overrides) shows as locked in Settings, and a saved value applies only while the environment leaves its key unset or empty. LoRAs, Cloud Models and inpainting have no switches: groups grant LoRAs and Cloud Models, and inpainting is always on.

`STUDIO_DEFAULT_IMAGE_PROFILE` and `STUDIO_DEFAULT_VIDEO_PROFILE` optionally select the instance’s default ready workflow IDs. They apply to a fresh composer and mode changes; existing drafts remain intact. Missing or unavailable IDs fall back to the first ready profile. Reference-image variants run separately to limit GPU memory. Image workflows apply their batch count when selected; fresh image preferences default to one, while video and workflows without batch support use one.

`STUDIO_THUMBNAIL_CACHE_MB` caps the gallery's thumbnail cache (2048 by default; the least recently shown go first).

Model downloads follow the Hugging Face tools' own settings. `HF_TOKEN` opens gated repos and is only sent to huggingface.co, `HF_ENDPOINT` points downloads at a mirror, and `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` send them through a proxy. Existing administrator credential APIs remain available; the rewritten settings page does not expose provider credentials.

## Civitai Images & Downloads

Imports into the **Library** are disabled by default. Set `STUDIO_ENABLE_PRESETS=1` only on instances that should offer them; keep it unset or `0` everywhere else. The server enforces this switch for saved images, thumbnails, imports, provider downloads and Civitai token settings, and the Library's Imports and Inspiration sections follow the server’s feature flag. The Library itself (LoRAs, Models and Downloads) is always there for administrators, and existing catalogue downloads remain available independently.

Open the **Library** from the navigation. **Imports** accepts a Civitai image or model link or a Hugging Face file or repository link and records each import in `studio.sqlite` (`studio_library_imports`) with its grade (Exact, Close or Partial) and reasons. A Civitai image appears in **Inspiration** and in this studio’s gallery with its prompt, generation settings, checkpoint and LoRA associations; a LoRA writes its catalogue entry; a checkpoint is recorded. Missing files wait for **Download Missing**, which queues them through the configured downloader; paid, early-access and restricted Civitai files are never downloaded and show why. Filename conflicts stay explicit. **Clear Failed** removes every failed import record (also the `imports` admin tool's `clear_failed`) and **Remove** in an import's ⋯ menu removes one; downloaded files stay. Existing saved presets migrate to gallery images when the Library opens. Imported images use the normal viewer, settings reuse, reference selection and deletion behaviour. Deleting an image keeps downloaded models. An administrator removes a catalogue entry and its installed file with the `catalogue_edit` admin tool's `remove`, refused while a profile still names the file; a LoRA first leaves every account's stacks, saved stacks, strengths, ratings and recents; undo brings the entry back for the file to be downloaded again.

**Use Settings** applies the image’s recipe to its installed image workflow without starting a generation. Exact resource matches use SHA-256, including renamed files. Missing LoRAs, unknown weights and unsupported resource types require attention; **Use Prompt** is available independently. Civitai metadata is optional, and additional processing such as ControlNet, high-resolution passes and CLIP skip needs a matching workflow. Imported settings cannot guarantee an identical image.

**Imports** also accepts Civitai model links (including `modelVersionId`) and Hugging Face links to individual SafeTensors or GGUF files. Downloads go to the worker through the resumable queue and check published SHA-256 values. Hugging Face revisions are pinned to a commit when previewed. A filename conflict is never resolved by replacing the existing file automatically.

Gallery Upload accepts files, folders, drops and the installed app's share
target. Images and MP4/WebM videos (up to 200 MB for video) become the uploader's
gallery items under Uploads. A video used as a reference supplies its first
frame.

**Import from Reddit** accepts post, gallery and share links from reddit.com,
old.reddit.com, redd.it and reddit.excloo.com. Studio fetches only the Redlib
front end at `https://reddit.excloo.com`, including its proxied images and
same-host redirects. Imported PNG, JPEG and WebP images become the caller's
uploads with the post link and title. A post with no images fails; individual
image failures are reported.

Public imports do not require a token. Set `CIVITAI_API_TOKEN` in the server environment for resources your account can access. Tokens are kept on the server and are never returned to the browser or forwarded to the image/file CDN. Imports, image deletion and model downloads are available to administrators (in single-user mode, the computer running Studio). Provider credential changes retain the existing admin boundary; the library does not expose credential controls.

## Prompt Assistant

The prompt assistant uses an OpenAI-compatible Bifrost gateway: `STUDIO_ASSISTANT_URL`, `STUDIO_ASSISTANT_KEY` and `STUDIO_ASSISTANT_CLOUD_MODEL`. Credentials remain server-side. Without the gateway, the assistant is off. Bifrost fixture compatibility is separate from live gateway verification.

Bifrost picks the model behind each alias; Studio picks the alias and its reasoning. Calls go to `STUDIO_LOCAL_TEXT_MODEL`, such as `local/auto`, while a [text workload](#queue-sessions--runtime-control) runs; otherwise, and in single-user mode without runtime control, to `STUDIO_ASSISTANT_CLOUD_MODEL`, such as `cloud/auto`. For an account with uncensored access an `…/auto` alias becomes `…/uncensored` (Bifrost defines both); any other model is used as it is. A switch shows within 30 seconds, and Bifrost never falls back between them. Where Studio wants a structured (JSON) answer (Dream, Describe, captions, LoRA suggestions, suggestions, the taste summary, guide and profile drafts), it sends `reasoning_effort: "none"`; prose (rewrites, negatives, titles, motion prompts) sends none and gets the model's default.

- `STUDIO_ASSISTANT_MODEL`: a model, such as `refuseless/glm-5.3-flash-abliterated`, that replaces the alias for every call and sends no `reasoning_effort`. Unset, Studio picks as above. Administrators choose it under **Settings › Integrations › Prompt Assistant › Model** from the gateway's models and those of Studio's text workloads, or **Automatic** to leave it unset.

Configure these in the deployment. The retained administrator integration APIs list gateway models (`GET /v1/models`) and whether the text model reads images. The cloud route always reads images; the local route does only when every running text workload sets `"vision": true`. Reference reading, Describe and Gallery Captions all follow this answer. The rewritten settings page does not expose integration editing.

Every account whose group has **Prompt Assistant** may use the prompt assistant. Spicy, and explicit wording from a Custom instruction (at most 500 characters), need **Uncensored Models**. LoRA suggestions need **LoRAs**, and drafting guides and profiles is for administrators. Replies are never logged; logs carry only the operation, profile, timing and a short failure reason. Every call times out after 90 s and falls back: a rewrite returns the original prompt, a negative the guide's default, LoRA suggestions the word-matched candidates. Prompts written for a generation are the queue's [writing stage](#queue-sessions--runtime-control) instead: they never fall back, and an unusable reply is retried once before the item fails with the cause (such as `empty reply` or `reply cut off at the token limit`).

**Background AI** (**Settings › Generation**, administrators) has a switch for each model call Studio makes on its own. Each is on by default and `0` turns it off, and an off switch means the call is never made, with nothing shown in its place. What a person asks for (Improve, Ask for a Change, Animate, Chat replies, taste Refresh) has no switch.

- `STUDIO_CHAT_TITLES` (**Chat Titles**): names a new chat from its first request; off, it stays New Chat until renamed.
- `STUDIO_GALLERY_CAPTIONS` (**Gallery Captions**) and `STUDIO_IMAGE_SEARCH` (**Image Search**, SigLIP 2 rather than the assistant model): the gallery search aids described below.
- `STUDIO_GALLERY_TITLES` (**Gallery Titles**): titles finished images and videos.
- `STUDIO_NEXT_STEPS` (**Next Steps**): the Suggestions menu's changes for a finished image (written ahead while idle and when the viewer opens) and for the composer's draft; off, the menu offers none.
- `STUDIO_PROMPT_IDEAS` (**Prompt Ideas**): ideas over an empty, focused prompt.
- `STUDIO_SUGGESTED_PROMPTS` (**Suggested Prompts**): prompts for items without one, such as uploads.
- `STUDIO_TASTE_UPDATES` (**Taste Updates**): the background summary of taste profiles.

Dream has no switch here: it is off for each account until turned on, and a group's Dream feature turns it off for its members.

Each account's **Taste Profile** (Dream › Taste) learns from stars, comparison
votes, iterations and Dream choices. Each of its latest 200 signals keeps the
result (and the one passed over): its prompt, negative, profile, LoRAs with
strengths, settings, seed, title and caption tags, a comparison's axis and
values, and the Dream arm. Studio scores what those results had (profile, LoRA
at its strength, caption tag, aspect ratio, and steps and guidance per profile)
on every read, each signal halving in weight every 60 days: a star counts 1.5,
a like or keep 1, a discard −0.5 and a calibration like or pass ±0.5. A
comparison's answer moves only what its two sides differ in: the winner's by 1
and the loser's by −1, or both by 0.5 for Both and −0.5 for Neither. Every ten
signals the assistant summarises titles, captions and tags into likes, styles,
things to avoid and a note, without touching the scores; the summary Chat and
suggestions read is written from both. The profile is not free text: the
person adds what to avoid, refreshes or resets it. Background summaries wait
while the text runtime is offline.

**Dream** is off for each account until turned on and also needs its group's
Dream permission. It makes images and optional videos from taste and recent
starred prompts while Studio is idle, using only ready local profiles the
account may use. Its settings control the unseen buffer, daily image and video
caps, videos and Spicy (which also needs Uncensored Models). Each account has
at most one Dream job at a time, shown in its queue with a Dream badge. It waits
at the lowest queue tier, below every account's own and MCP work and finishing
upscales, and runs once that work is done; Dream starts
a new one only while Studio is idle. A waiting Dream job doesn't hold up
idle-time work such as captions and Finish Starred Images. Pausing Dream cancels its waiting job; queue Stop All
and Cancel Pending leave Dream alone. Offline or parked text/media workers make
it wait.

Three in four Dream ideas exploit taste: the profile, a compatible LoRA (a
thumbs up counts in its favour) at its learnt strength, steps, guidance, aspect
ratio and a liked caption tag are drawn by their scores. The rest explore
exactly one thing, in turn: a little-used profile, an unrated LoRA no result has
taught yet, or new ground for the prompt (half from an import, where allowed).
Thumbs-down LoRAs are never loaded. Import and Inspiration ideas need
administrator access, Uncensored Models and enabled imports. Results stay
outside the gallery, search, exports and MCP until kept; Star also keeps them.
Discards remain available. Variations keeps a result and queues new seeds as
user work; More Like This keeps it and steers upcoming ideas toward it.
Comparison cards vary one thing and accept A, B, Both or Neither, and ask about
what taste is least sure of. Calibration cards use older Studio generations
owned by the account, never uploads or imports, without GPU work; their answers
teach taste without changing the gallery unless explicitly starred.

**Settings › Preferences** follow the account: Tile Captions, Cloud Models,
LoRAs, Uncensored Models and Spicy Prompts. Feature switches can only narrow the
group's grants. Spicy Prompts is off until enabled and needs Uncensored Models.
A browser's old Tile Captions preference is imported only if the account has
none, then removed from the browser.

**Finish Starred Images** (Settings › Preferences) is off until enabled. It
smart-upscales starred, finished gallery images while idle, using the upscale
worker rather than the cloud. Choose Fast, Balanced or High quality and Face
Detail; automatic sizing applies. Face Detail requires a full-body person and
the worker's detector and Impact Pack support. Missing worker, nodes or models
leave the list waiting. Unstar removes work that has not started; disabling
clears the list. Waiting work ranks above Dream but yields to other new work and
returns to the list; started work finishes.

**Gallery Titles** summarise finished media's prompts. Until titled, the
prompt's first words stand in; items without prompts get no title.
**Suggested Prompts** describe how to recreate uploads and other items without
a prompt, using the image (a video's first frame) when the text model reads
images, otherwise its caption. An item with neither waits. Edit › Edit Prompt
stages the suggested prompt; the selection's Edit › Run Suggested Prompts queues
the selected uploads that have one and reports those still waiting.

**Gallery Captions** let search match visible image content and tags alongside
prompts. They need a running text model that reads images, with no cloud
fallback. Administrators can run **Settings › Generation › Caption Gallery**
for Out of Date, Missing or All captions and stop a pass. Passes resume after
restart, yield to other work and skip failed images until the next start.
Unkept Dream results are captioned too, so their verdicts teach what they show.
Titles, suggested prompts and captions skip disabled or removed accounts.

**Image Search** adds visual matches to text search using
[SigLIP 2](https://huggingface.co/google/siglip2-base-patch16-224) on Studio's CPU.
Images stay in Studio; all accounts' images can be indexed. The first use
downloads about 690 MB of ONNX models into the data directory (`HF_ENDPOINT`,
`HF_TOKEN` and proxy settings apply). A model revision starts the index again;
vectors live in SQLite and memory. Until indexed, search is text-only.
Administrators can start or stop **Settings › Generation › Index Gallery**.
Image Search is disabled in demo mode.

**Run While Busy** (**Settings › Generation › Gallery**, `STUDIO_GALLERY_WHILE_BUSY`, off by default; `1` turns it on) lets gallery captions, image search, titles, suggested prompts and next steps run while Studio is generating or chatting instead of waiting until it is idle, so they no longer yield to other work. Dream and Finish Starred Images still wait for idle.

MCP's `search` tool (Studio Chat's too) runs this gallery search, with its kind and Starred filters, over the account's own finished results, newest first. Each match gets a result ref in the conversation, so `reuse`, `review` and `result` take it; a job another MCP identity holds is left out. With `uploads: true` it searches the account's uploads instead (by file name, caption or suggested prompt) and returns each as a `reference_asset_id` that Generate takes; a reference another MCP identity uploaded is left out.

A chat host such as LibreChat cannot pass an attached file to a tool, so MCP's `upload_link` tool returns a one-time page at `/mcp/results/upload/…` under `STUDIO_MCP_PUBLIC_URL`, sealed like a result link and needing no sign-in. It takes one PNG, JPEG or WebP image (or a HEIC photo sharp can read, saved as JPEG) of up to 20 MB as the caller's upload within 15 minutes, then closes; open links live in memory, so a restart ends them. The tool also returns the `reference_asset_id` the image becomes, so the chat passes it straight to Generate once the user has uploaded it; until then Generate refuses it with that advice.

**Suggestions** offers prompt ideas, next steps and taste context. Next steps
are written ahead while idle and can be refreshed in the viewer. Explicit
suggestions need both Spicy Prompts and Uncensored Models; changing either
causes saved next steps to be rewritten on the next request. Without a
configured assistant or while the text runtime is offline, suggestions return
an empty list with the reason, without fallback text or a cloud model.

`mise run eval:assistant` replays the recorded cases in `backend/fixtures/assistant-evals/` against the live gateway, using the variables above, and scores them; `--record` writes the live replies back for review. CI only scores the recorded replies.

## Profiles, Guides & Catalogue

Studio owns editable live definitions in its data directory: profiles in `workflows/`, prompting guides in `guides/`, and catalogue changes in `library/`. Administrators edit and approve these in Library; user presets remain account-owned runtime data. Existing identifiers are preserved; each profile maps its controls in its `studio` block.

**Resolution:** an image run on a profile with adjustable width and height draws at a resolution tier, `1K`, `2K` or `4K` (the long edge: 1024, 2048 or 4096 px, each side rounded to the profile's step), 1K unless the composer, Chat, Compare, Dream or MCP `generate`'s `resolution` names another. Studio applies it when the job is admitted, so a profile's default width and height (and an MCP call's `width`/`height`) give only the aspect. Where the model family doesn't draw a tier itself (`native` in the family catalogue), the run draws at 2K where it can, else 1K, and Smart upscale in the same job takes it to the tier. Videos, cloud profiles, a painted mask and a reference that frames the output keep their own size.

`guides/prompting.json` is the only source of prompting guides. A profile's guide is the pack its binding names, else its family's pack for its kind (`families.<family>.<kind>`), with the binding's mode and variant and its `negatives` entry, so a profile needs a binding only for a different pack, a mode or a variant. The family map, bindings, variants and negatives are versioned together and edited in chat with the `profile_edit` admin tool (`target: bindings`). A profile's own `studio.prompting` holds only the fields that differ from that guide (such as its own `negative` or `mode`); each goes over the guide's field of the same name, and every other field follows the guide, so a guide edit reaches every profile that doesn't override that field. A backend's `prompting` goes over the shared one, and an image mode's over its profile's, field by field. Studio, MCP and the prompt assistant all read this merge.

A guide store's profile bindings (`profiles`: which pack, variant and mode a `custom:<id>` uses; `variants`; `negatives`) are one versioned document beside the packs: `GET`/`PUT /api/profiles/guide-bindings` (`{bindings, baseHash}`), with `versions`, `revert` and `approve` like a pack, and the `profiles` and `profile_edit` admin MCP tools with `target: "bindings"` (a merge patch's `null` removes a binding).

The sample profiles in `backend/samples/` seed a data folder that has never held a profile (a new install or local development); after that, the data folder is the only source. Exports through the retained administrator API are the backup.

**Merge Duplicate Profiles** in Library › Profiles previews equivalent profiles
and requires an administrator to apply; it never runs at startup. Same-named
profiles with different definitions or no unambiguous ID to keep are left for
review. It backs up removed files and affected metadata under
`backups/profile-merges/<time>/`. Preferences and LoRA stacks move to the kept
profile; old IDs continue resolving through aliases, which exports include.
Version history stays.

Library › Profiles › Delete Profile (in a profile's editor, or the `profile_edit` admin MCP tool's `remove`) removes one profile after a confirmation: it copies the file to `backups/profile-removals/<time>/`, records it as the profile's last version so its history stays and its id is never reused, then removes the file and its guide binding and negatives. Records that name the id stay as they are and report the profile as missing; to restore it, save the backed-up file as a new profile.

Library › Guides › Delete Guide (in a guide's editor, or `profile_edit`'s `remove` with `target: guide`) removes a guide pack after a confirmation. It refuses while a profile binding or the family map still uses the pack; bind those to another guide first. The pack's versions stay, the last one holding it, so reverting to that version (`POST /api/profiles/guides/<id>/revert`) brings it back.

### Profile Backends

A profile can run one model on Radiance or ComfyUI. Its `studio` block then holds the shared fields (`id`, `name`, `kind`, `family`, `uncensored`, `prompting`; the guide binding and negatives follow the profile id), the backend it runs on and each backend's own block with its graph:

```json
{
  "studio": {
    "id": "image-krea2-turbo-fast",
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

Readiness, worker routing, validation, the graph, timings and labels follow the backend a run uses. A backend that isn't ready shows the profile as Needs Setup with the reason; Studio never runs it on the other backend instead. Switching `backend` (the Backend select in Library › Profiles) is an ordinary versioned edit. Jobs and gallery records keep `profileBackend`: Repeat Exactly, Edit Prompt and MCP's Reuse run on the backend that ran while the profile still has it, otherwise on its current one, with a note.

**Combine Backends** in Library › Profiles (or the `combine_backends` MCP tool)
previews Radiance/ComfyUI pairs for an administrator to select, name and choose
a default backend. It never runs at startup and refuses a stale preview.
Applying backs up the files and affected metadata under
`backups/profile-backends/<time>/`, then combines their definitions, preferences,
LoRA stacks and timings. Old IDs keep their backend through aliases; records
are not rewritten and version histories stay. Exports include those aliases.
An interrupted apply can resume; repeating a completed apply changes nothing.

## SQLite Migration & Rollback

Native Node SQLite stores, in `studio.sqlite`, the persistent queue, sessions, Chat messages, user presets, accounts and account sessions (the `accounts` document), deletion markers (`gallery-hidden`) and the gallery (one `studio_gallery` row per item). It also holds what were JSON files beside it: workflow preferences, timings, model types, saved presets, library update checks, comparisons, MCP ownership and the MCP assistant's records as documents; each account's prompt histories and LoRA stacks as `<name>:<key>` documents (the key is the SHA-256 of the account id, empty in single-user mode); import records in `studio_library_imports`; and ingested runs in `studio_ingested_jobs`. Profiles, `history/`, guides, `config/models.json`, `library/catalogue.json`, deployment settings and media stay files. A new data folder starts with these tables. A folder from an older version that still holds `accounts.json`, `gallery.json` or `gallery-hidden.json` without the `runtime-json-v1` migration, the single `gallery` document without `gallery-rows-v1`, any of the moved JSON files without `json-stores-v1`, or gallery rows or queue records with old status words without `status-words-v1`, stops Studio at start with a message naming them, until the explicit offline migration below has run. A local development folder needs one `node backend/commands/migrate-runtime.mjs --data-dir data --apply`.

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

The `jsonStores` step (`json-stores-v1`, [json-stores.ts](backend/persistence/json-stores.ts)) runs last. Apply copies every moved file and its `.bak` to `.backups/json-stores-*`, commits the rows, their round-trip check and the marker in one transaction, then deletes the files. A file that is unreadable or whose row already exists is a conflict: nothing moves and the command exits non-zero. Earlier steps that rewrite preferences, timings, model types or LoRA stacks now read the moved documents, so a folder that skipped them needs a second `--apply`; the dry run after that lists nothing. Deploy a version with this step in this order:

1. Take a ZFS snapshot of Studio's data.
2. Scale Studio to 0.
3. Run the new image's migrate-runtime dry run against the data folder and resolve any conflict.
4. Run it with `--apply`.
5. Rehearse `--restore` of the new `.backups/json-stores-*` folder into an empty directory.
6. Scale Studio up.

To roll back, scale Studio to 0, roll the data back to the snapshot and deploy the previous image; work done since the migration is lost.

The `statusWords` step (`status-words-v1`, [status-words.ts](backend/persistence/status-words.ts)) runs after it. Studio says `failed`, `cancelled` and `cancelling` for a job's or result's end; older builds stored `error`, `canceled` and `canceling` in gallery rows and in the gallery items queue records carry, in their `status` and `upscale.status`. The dry run counts each rewrite under `words` and the affected `studio_gallery` rows and `studio_queue` records. Apply copies those rows to `.backups/status-words-*` as `studio_gallery.json` and `studio_queue.json`, then rewrites them and records the marker in one transaction. Deploy it with the steps above.

The command runs all migration steps in [runtime-migrations.js](backend/runtime-migrations.js)
in order. Its dry run names affected records and conflicts; use that plan and
the step's source for record mappings. In addition to SQLite, it migrates old
uploads, profile references, catalogue layers, account access, LoRA ratings,
gallery lineage and dimensions, prompting overrides and saved environment
settings. It never adopts unrelated jobs from shared worker history.

Before applying:

- Resolve reported conflicts. Missing upload files stay behind; unresolved
  profile references need review.
- Complete catalogue-layer, download-source and legacy-record migrations before
  deploying a version that no longer reads those formats.
- Review account-access changes: pending accounts join the default group and
  retired feature restrictions go. Until migrated, pending accounts cannot
  sign in. Migrate LoRA favourites before editing that library, or its old
  favourites list will be lost.
- Environment settings move into SQLite and replace its saved values because
  the environment values were in effect. Unrelated environment keys stay.
- `combinedProfiles` and `uncensoredMarker` write **without a step backup**.
  `--dream-owner <account id>` also writes without one: it removes Dream answers
  and taste signals about other accounts' results. Supply it only for the one
  account that used Dream. Keep the complete pre-migration snapshot.

Other steps write backups beneath `.backups/`, with mappings or restore
manifests for the affected files or rows. The upload step keeps the retired
reference store there; profile renaming preserves old-ID resolution and can
resume after interruption. A backup restores only that step's metadata, not a
complete data directory. Use `--restore` with each backup and a separate empty
`--destination` to inspect the recovered files before a stopped-service restore.

An administrator can inspect the same steps online with
`POST /api/maintenance/migrations` and `{}`, or the `maintenance` MCP tool's
`migrations` action. `{ "apply": true }` applies only steps marked safe online,
backs them up and reloads the affected stores. Steps requiring downtime return
`refused`; run those with the offline command. The online path excludes
`--dream-owner`. Logs record counts, outcomes and backup folders.

## Queue, Sessions & Runtime Control

`/api/sessions` stores generation inputs and result relationships; `/api/queue` exposes writing, queued, waiting, starting, running, saving, completed, failed and cancelled operations.

**Writing** is the first stage of a generation whose prompt the prompt assistant writes: the viewer's Animate themes, MCP `reuse` when Studio writes the prompt from a change, and Dream. MCP `generate` and Chat run the prompts the chat model wrote, exactly as sent. One click or call queues the job; it writes its prompt, then queues for its worker, with no review pause. The thinking (`reasoning_content` and `<think>` blocks) and the prompt stream into the queue item, and the result keeps the written prompt with its text model and thinking, collapsed under the prompt in Details. The shared text model writes at most two prompts at once, higher queue tiers first and then in order; the rest wait in their writing stage. A failed write fails the item with the reason (Retry writes it again); cancelling stops the writing; a restart writes it afresh. MCP's status and replies leave the thinking out. Users can cancel their pending jobs and retry failed jobs. Recorded provider jobs are recovered before any resubmission. Ambiguous submission outcomes stay visible for investigation rather than creating duplicate generations.

Work waits for the selected worker by default. Independent resources can run concurrently. A worker's admission remains held until results are safely saved. Runtime status is administrator-only.

Studio switches the GPU workloads itself: each is a Kubernetes deployment it scales between 0 and 1 replicas. At start it finds the deployments labelled `studio.excloo.dev/kind` (`image`, `video` or `text`) in the namespaces `STUDIO_KUBERNETES_NAMESPACES` lists, and `STUDIO_KUBERNETES_GPUS` gives the GPUs per node pool:

```bash
STUDIO_KUBERNETES_GPUS='{"gpu": 2, "gaming": 1}'
STUDIO_KUBERNETES_NAMESPACES=comfyui-image,comfyui-video,text
STUDIO_LOCAL_TEXT_MODEL=local/auto
```

Each deployment states the rest itself. Its name is the workload id; its pool is the value of its pod node selector that names a `STUDIO_KUBERNETES_GPUS` pool; its GPUs are the exact device counts of its pod's resource claim templates; its address is `http://<service>.<namespace>.svc.cluster.local:<port>`, from the one Service selecting its pods and that Service's first port, which several deployments may share. Workloads are listed by namespace, then name, and the first of several at one address is the one to start. Optional annotations under `studio.excloo.dev/` add `label` (its display name, else its id), `vision: "true"` for text workloads that read images, and, for media, `worker` and `capabilities`. Without `STUDIO_WORKERS`, each address of the image and video workloads is one [worker](#workers): `worker` gives its id (else the first workload's id; keep ids stable so earlier jobs keep their worker), the first workload's `label` its name, and `capabilities` what it runs, comma-separated (else the workloads' kinds); with `STUDIO_WORKERS`, media workloads match their worker by address. Text workloads all serve `STUDIO_LOCAL_TEXT_MODEL`, the gateway model the [prompt assistant](#prompt-assistant) asks for while one runs, and take `STUDIO_TEXT_KEY` as their health check's bearer key; both are required once a text workload exists. Chat shows administrators that model while its workloads are stopped, and choosing it starts the first that fits beside what runs (or, confirmed, stops what it needs room from, media first); other accounts see it while one of its workloads runs, and marked Stopped, unchoosable, while all are parked. Anything missing or ambiguous, such as no pool or two Services selecting one deployment, stops Studio at start with the deployment's name; restart Studio after adding or changing a workload. Studio uses its pod's service account, which needs a role in each listed namespace to list deployments, Services and `resourceclaimtemplates`, read pods and update `deployments/scale`, and `get` on `pods/log` for each workload's View Log (`GET /api/runtime/workloads/:id/logs?lines=200`, 1–1000; without it Studio answers 503 "Pod logs aren't permitted yet" and the rest of Settings › Workers keeps working); `STUDIO_KUBERNETES_URL` (such as `kubectl proxy`) replaces it for local development.

**Settings › Workers** shows each workload's state, GPU use and why a pod is not ready (such as a GPU claim that cannot be allocated). An administrator ticks the workloads that should run and reviews a preview before applying it; every workload left out stops. Restart scales a running workload to 0 and back. One change runs at a time: Studio stops accepting new work on the workloads that leave, waits for their accepted work to finish and save, scales them to 0, waits for their pods to go (their GPU claims are released only then), then starts the others and waits for them to be ready. Each change is recorded with its requester, timestamps, steps and the placement before and after, and the history survives restarts; a change cut short by a restart is marked interrupted. A deployment stopped outside Studio, such as by a Flux upgrade that resets replicas, shows as changed outside Studio.

A workload scaled to zero on purpose (by Studio or an administrator) is parked and reads **Stopped**, not failing: Settings › Workers, the header status (grey, never red), the composer's profile list, Chat's model list, Dream's reasons, MCP `models` and `generate` and the waiting reason of queued work all say so, and administrators get Start where it shows (a Workers row, the status panel, choosing the profile or Chat model). Scaled to zero while Studio's last applied placement has it running, it is **Down**, and its worker shows offline. With automatic control on, nothing is held back as parked: queued work starts what it needs.

Automatic control (the Automatic Control switch in Settings › Workers, off until an administrator turns it on) starts and stops only media (image and video) workloads. Queued work for a stopped media workload starts it, stopping the media workloads in its pool it needs room from (idle ones first), and waits with "Waiting for <workload> to start". It never stops or starts a text workload, because LibreChat and Bifrost call text models directly and Studio cannot see those requests: if a running text workload holds the GPUs the media workload needs, nothing changes and the work waits with "Waiting for a GPU: <text workload> is running; stop it in Settings › Workers". A stopped text workload is started in Settings › Workers, by an administrator choosing its model in Chat or with the control MCP tools, which may stop text as an explicit choice. With or without automatic control, after an outside stop (such as a Flux upgrade, which resets GPU deployments to 0) Studio restores its last applied placement within 30 seconds, keeping any running text; while that text holds GPUs the placement needs, the restore waits. Without automatic control, work for a stopped workload waits with the reason that it is parked or down.

With automatic control on, Park When Idle (Never, or 10 to 60 minutes) parks a running media workload after that long without work, so its GPUs can idle; the next queued work for it starts it again. Work in progress keeps it running, a workload first seen running (or running when the setting changes) counts as used then, and text workloads are never parked.
