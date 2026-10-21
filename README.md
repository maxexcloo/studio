<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/studio-lockup-white.svg" />
    <img src="./public/studio-lockup-black.svg" alt="Studio" width="260" />
  </picture>
</p>

<h3 align="center">ComfyUI, without the graph.</h3>

<p align="center">
  A local front end for ComfyUI.<br />
  28 model families work out of the box, and your own ComfyUI workflows come along. Write a prompt and watch it render.
</p>

<p align="center">
  <a href="https://github.com/maxexcloo/studio/releases/latest"><img src="https://img.shields.io/github/v/release/maxexcloo/studio?style=for-the-badge&label=release&labelColor=1a1a1a&color=ff7a3d" alt="The latest release" /></a>
  <a href="https://github.com/tristmeister/HEISS-UI"><img src="https://img.shields.io/badge/forked%20from-HEISS%20UI-ff7a3d?style=for-the-badge&labelColor=1a1a1a" alt="Forked from HEISS UI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-444?style=for-the-badge&labelColor=1a1a1a" alt="MIT license" /></a>
</p>

<p align="center">
  <b><a href="#quick-start">Quick start</a> &nbsp;·&nbsp; <a href="#supported-models">Models</a> &nbsp;·&nbsp; <a href="#inpainting">Inpainting</a> &nbsp;·&nbsp; <a href="#bring-your-own-workflow">Workflows</a> &nbsp;·&nbsp; <a href="#troubleshooting">Help</a> &nbsp;·&nbsp; <a href="#faq">FAQ</a></b>
</p>

<p align="center">
  <img src="./docs/screenshots/hero.jpg" alt="Studio: a masonry gallery of generated photographs, two still resolving as pixel mosaics, with the prompt composer floating at the bottom" width="1100" />
</p>

<p align="center">
  <sub>Free and open source under MIT. A fork of <a href="https://github.com/tristmeister/HEISS-UI">HEISS UI</a>, built on <a href="https://github.com/jasperdevs/J-AI-Studio">J-AI Studio</a> by Jasper.</sub>
</p>

---

Studio is a hard fork of HEISS UI, maintained at [maxexcloo/studio](https://github.com/maxexcloo/studio). It branched from [HEISS UI v0.18.0](https://github.com/tristmeister/HEISS-UI/releases/tag/v0.18.0) (commit `a0452538d14a74b23e1422e59a9f24b4781f2406`, recorded in `server/release-identity.json`) and no longer follows upstream: Studio owns its code, uses its own numeric Semantic Versioning and adds accounts, media storage, MCP and deployment settings.

Studio only ships as a container image, `ghcr.io/maxexcloo/studio`. There are no desktop downloads, double-click launchers or in-app updater; you update it by deploying a newer image.

Studio sits on top of the ComfyUI you already run. You get a prompt box, a gallery and the settings that matter for the model you picked. ComfyUI still runs every job and keeps your nodes, models and outputs.

The node graph is for building workflows. Studio is for the everyday loop of prompt, wait, look, tweak, and your workflows come along.

## Features

- **28 model families, ready to go.** From SD 1.5 and SDXL to Flux.2, Qwen-Image, Krea 2 and Wan 2.2, each with its makers' recommended settings. [The full list ↓](#supported-models)
- **Missing parts, one click away.** Pick a model and see what it still needs, with a Download button for each part and **Get all** for the lot.
- **Native Resolution.** Pick a supported 2K or 4K resolution and the model draws it in one run, with no upscale in between. Or set any size of your own, in pixels or megapixels, and save it for every device. [Sizes ↓](#native-2k-and-sizes)
- **Smart upscale.** Any picture goes to 2K or 4K with SeedVR2 in one click, with a countdown. [How ↓](#smart-upscale)
- **Bring your own workflow.** Import a ComfyUI workflow and it becomes a clean set of controls, with your graph running underneath. [How it works ↓](#bring-your-own-workflow)
- **Inpainting (beta).** Paint over part of a picture, say what it becomes, and only that part changes. No extra nodes, and it works with 18 image families.
- **Auto-grouping.** Ten takes of one idea become one tile, so a gallery of hundreds stays easy to scan.
- **On your phone and every device.** A phone layout made for one thumb, and the full studio on any laptop or tablet on your network. Your PC renders, and every device shares the same models and gallery. [Set it up ↓](#on-your-phone)
- **Civitai-ready images.** New PNGs always carry their prompt and settings in a form Civitai fills in for you on upload.
- **Library.** Administrators open the **Library** to import a Civitai image or model link or a Hugging Face link. Each import is graded Exact, Close or Partial with its reasons, lists the files it still needs and downloads them with **Download Missing**; paid and early-access files are never downloaded. Images join your gallery with their settings, LoRAs write their catalogue entry, and the LoRAs, Models and Downloads pages show what is installed and where it came from. Imports are off by default; set `STUDIO_ENABLE_PRESETS=1` on the instances that should offer them (see [Configuration](docs/guides/CONFIGURATION.md#civitai-images--downloads)).

Open **LoRAs** in the composer to select effects and adjust their strengths. Drag the selected effects by their grips to change the applied order, or use the Up/Down buttons or arrow keys on a grip. **Info** shows available descriptions, trigger words and source links without fetching extra metadata.

<p align="center">
  <a href="./docs/screenshots/realtime-generation.mp4"><img src="./docs/screenshots/realtime-generation.gif" alt="Two new images resolving live in the gallery, from pixel-mosaic step previews to the finished photograph" width="100%" /></a>
</p>

## Quick start

**1. Have ComfyUI running** somewhere the container can reach, and note its address.

**2. Run the image** with that address and a folder for Studio's data:

```sh
mkdir -p data
docker run --env COMFY_URL=http://comfyui.local:8188 --init --publish 127.0.0.1:8787:8787 --rm \
  --user "$(id -u):$(id -g)" --volume "$PWD/data:/data" ghcr.io/maxexcloo/studio:latest
```

**3. Open http://localhost:8787.** Models, samplers and VAEs show up once ComfyUI is connected. [Containers](#containers) covers video backends, storage and image tags.

<details>
<summary><b>No ComfyUI yet?</b></summary>

Get [ComfyUI Desktop](https://www.comfy.org/download), leave it running, and Studio connects on its own.

</details>

<details>
<summary><b>Install from source</b></summary>

To run without a container or change the code. This needs **Node.js 20.9+** (22 LTS or newer recommended).

```bash
git clone https://github.com/maxexcloo/studio.git studio
cd studio
npm install
npm run build
npm start
```

`npm start` serves **http://localhost:8787** (or the next free port if that one is taken). Models, samplers and VAEs show up once ComfyUI is connected.

ComfyUI on another machine or port? Set its address in **Settings › Workers**, or copy `.env.example` to `.env` and set `COMFY_URL`.

</details>

## Containers

The Dockerfile builds a Linux AMD64 image for Docker and Podman. Set `COMFY_URL` to the existing ComfyUI endpoint reachable from the container, then build and run:

```sh
docker build --tag studio:local .
mkdir -p data
docker run --env COMFY_URL --init --publish 127.0.0.1:8787:8787 --rm \
  --user "$(id -u):$(id -g)" --volume "$PWD/data:/data" studio:local
```

Studio runs on zero, one or many ComfyUI workers, each with what it can do (image, video, upscale, model downloads). Add them in **Settings › Workers**, or define them for the deployment with `STUDIO_WORKERS` (a JSON list; see [Workers](docs/guides/CONFIGURATION.md#workers)). `COMFY_URL` and `COMFY_VIDEO_URL` still work as the image and video workers. Each job goes to a worker with the capability it needs; progress, uploads and cancellation follow its worker, and Studio never falls back to another kind of worker or the cloud. On phones, select **Video** on the **Create** sheet and choose a video model; duration controls are under **Advanced Settings**.

Open `http://localhost:8787`. `/data` holds settings, galleries, histories and imported workflows. Mount ComfyUI's input, output and model directories separately when a feature needs local file access. The image runs as UID 1000 by default, exposes port 8787 and has a health check. It starts the server directly, so update the application by updating the container image.

CI calls the Container workflow once application and browser checks pass on `main`, and the Release workflow does the same for `v*` tags. The Container workflow builds the image, tests the runtime and scans for fixable high or critical vulnerabilities. Successful builds publish to `ghcr.io/<owner>/<repository>` (from `github.repository`) with an SBOM and provenance. `main` publishes `latest` and `sha-<full commit>`; a release tag publishes `X.Y.Z` and `X.Y`, and its GitHub release lists the changelog notes and the image digest. For deployments, prefer an immutable `sha-<full commit>` or version tag, or the image digest.

For local checks, run `mise run setup` and then `mise run check`. Renovate updates actions, base images and npm dependencies; `mise run dependencies:check` previews them.

### Native MCP

Studio has an optional Streamable HTTP MCP server at `/mcp`, on the same application port and in the same Node process. Set `STUDIO_MCP_API_KEY` on each studio instance to turn on its nine tools: Models, Generate, Status, Result, Review, Cancel, Upload, Reuse and Handover. Each key only reaches its own studio. You don't need an extra service, a Python runtime, studio passwords or other studio URLs.

Ordinary requests don't need a Models call. Generate takes `kind` and `tier` instead of a `profile_id` and uses a ready profile the account may use for that tier, preferring the deployment default and then its family. Without a `tier` it uses the fastest tier available, in the order Fast, Super Fast, Standard, Quality. Tiers come from the profile label: `quality` (Quality), `fast` (Fast), `turbo` (Super Fast) and `standard` (Standard or no tier in the label, otherwise Quality). Models lists profiles compactly as `id — label` lines grouped by kind, optionally for one tier; `turbo` and `fast` list both speed tiers, the named one first, and Generate's `turbo` falls back to Fast when no Super Fast profile is ready. Models with a `profile_id` returns the prompting guide, controls, a compact LoRA index and reference slots. Generate makes one output unless the user asks for more; the studio's own composer keeps its default of two. The chat passes the user's `request` in their own words; with explicit `prompts`, different images go in one call as separate prompts and `count` is the number of variations per prompt. One call queues 1–10 jobs (`prompts` × `count`, each a separate job) and waits for them together; the schemas accept more so that Studio, not a client's generic schema check, refuses an excess by naming the field, its range and how to split it. A `count` equal to the number of prompts is read as one image each. Each account's outstanding-job limit (`STUDIO_ACCOUNT_MAX_OUTSTANDING_JOBS`, default 2) still applies, so set it to at least 10 for chat batches. Models and Generate accept a `profile_id` by ID, label, family name or model words, such as "flux 3", "FLUX.3" or "turbo flux 3"; the model words decide the family and speed words such as turbo or quality only choose within it ("moss turbo" is MOSS's fastest profile, never another model's Turbo). With a `tier` as well, a named profile moves to that tier within its family, or to the family's nearest tier with a note to pass on. When several profiles of one family match, the fastest wins; words naming several families ("klein") list them in Models and are refused with the list by Generate. A miss lists the ready profiles of the family the name points at, or says the model isn't available so the chat tells the user instead of substituting another; a name of speed words alone names the three closest profiles, fastest first. Without a `profile_id`, a model the `request` names by family or model word ("six baby ducks, fast moss") is used as if it were the `profile_id`, when exactly one family is named; the reply says so. Every Queued and Done reply names the profile used. Several different images belong in one call: with `count`, the prompt writer gives each output its own prompt. `aspect` (`landscape`, `portrait`, `square` or a ratio such as `16:9`) picks the profile's own preset size, and `size: "2k"` or `"4k"` scales it to that long side where the profile draws it natively. Both replace invented `width` and `height` values.

Without prompt writing, the request is the prompt, so the chat writes it, and the first submission to a profile in a conversation (or, without a conversation header, for each account and profile) carries a compact prompting guide of at most 1,200 characters: the guide's summary, rules and pitfalls. Studio marks it as sent before it waits, so concurrent calls attach it once. A Models call with that `profile_id` returns the full guide and also counts as sent.

Generate waits up to `wait_seconds` for its jobs to finish. The default is 60 seconds for images, which is long enough for a cold model load, and no wait for videos; the maximum is 60. If every job finishes in time, it returns `status: done` with the same markdown a background Result notification returns, so quick images need no background Result or second agent turn. Otherwise, or if the client cancels the wait, it returns `status: queued` with each job's ID, a short reference such as `result 3` and a short link labelled with it, such as Result 3. The link opens a page that shows progress and then the finished outputs, so users can follow results without the chat. A reply with several results, or any still running, adds one All Results link: a page that lists every result of the conversation and fills in as they finish. References are numbered per conversation when the client sends `x-studio-conversation-id` (in LibreChat, for example, a header set from the conversation ID placeholder), and per account otherwise. Status, Result, Review, Cancel and Reuse accept a reference anywhere they accept a job ID.

Reuse handles follow-ups such as "again", "more like that" or "animate it" without a Models call. With the result's own `kind`, it runs the result again with the same profile and settings and a new seed; `request` applies a change in words (see [Prompt Writing](#prompt-writing); without it, the change is added to the prompt), `prompt` replaces the original prompt, and `tier` or `profile_id` moves it to another model of that kind at the same proportions. `count` defaults to 1. Set `preserve_seed: true` for a same-profile revision to keep its recorded seed; an unknown seed, animation or model/tier change is refused. With `kind: video` on an image, it animates the image as the first frame of a first-frame video profile, sized to the image's proportions. Without a `tier`, that's the fastest such profile. Reuse then replies and waits the same way Generate does. Without `kind`, it returns the image as a reference asset for Generate.

When the user asks to judge, compare or improve a finished image, Review returns an actual JPEG image content block alongside its full prompt and recorded settings; `compare_to` adds another result's first output. A vision-capable chat model can then assess prompt adherence, framing, pose, clothing coverage, anatomy and photographic quality and explain what to keep or change. The server supplies evidence, not its own model verdict, and a host that cannot pass tool images to the chat model cannot provide a visual assessment. Review is read-only and never rerenders. New runs include recorded queue and active timings plus estimated setup, sampling and finishing stages; Details shows these alongside total elapsed time. Setup includes model loading and input encoding, and total time may also include output transfer or post-processing. Older results show only timings actually recorded. A requested revision can use Reuse, keeping the seed fixed for a clearer comparison. Pending results return their link without polling; reviews retain the same account ownership and hidden/deleted-result checks as other tools. Ordinary Generate, Reuse and Result delivery remains text-only, and images are reviewed only when asked.

With the prompt assistant's gateway configured (`STUDIO_PROMPT_WRITER_*`), accounts with the Prompt Assistant feature also get RewritePrompt (a prompt rewritten for a profile with a preset; Spicy needs NSFW access, and a vision model reads `reference_asset_ids`), SuggestNegative (`{negative}`, or `{unused: true}` where the profile takes none) and SuggestLoras (name, title, strength, triggers and reason). They call the same engine as the composer's magic button, with the account's own access. A Generate whose prompt RewritePrompt wrote records the preset and any chosen SuggestLoras picks on its results, so Details shows "Assistant in Chat".

Handover prepares a copy-paste summary with the caller's decisions, preferences, unfinished work and the current conversation's recent job IDs and result links. It never generates images. Call it when requested, or when the chat host reports about 90% context usage; Studio cannot measure the host's context itself. Stable job IDs work in a new chat, while result numbers remain local to their original conversation. The host owns automatic usage detection and its summary interface.

MCP never chooses a provider-backed cloud profile such as Grok by itself. Automatic choices (a kind and tier, a model named in the request, Reuse and animation) use local profiles only, and Models lists cloud profiles apart under `cloud`. A cloud profile runs only when the user asks for it: its id or a name with "grok" or "cloud" in `profile_id`, or a request that says "grok" or asks for the cloud ("in the cloud", "a cloud model"; "a cloud over the hills" doesn't count). Its reply's `profile` carries `remote: true`. While no local video worker is available, video that didn't ask for the cloud is refused with "Local video is unavailable right now", and, only where the account may use a cloud profile, the reply says the user can ask for Grok instead; nothing is queued. The tool descriptions and instructions never name Grok, since an account may have none. When a cloud job fails with an authorisation or quota error (such as a CLIProxyAPI HTTP 401), Result and its page report "Cloud video unavailable (quota)", and for 10 minutes MCP queues no cloud video and says why. Before queueing cloud video, MCP reads the few most recent unfinished cloud jobs, so a refusal counts even if nobody asked for its result.

Status and Result return immediately by default. A queued reply tells the agent to share the result links and end its turn without calling Result, so a slow image or a video never holds the chat open. When the user later asks to see a result ("show result 3"), the agent calls Result with its reference and a short `wait_seconds` (at most 20). A job that's still running returns its link again. For "show them" or "show me all", Result with `job_id: "all"` returns the conversation's most recent finished results (up to eight) under their Result headers, with links for the ones still running and the All Results page. A client can still collect a job with one `delivery: notification` Result call, which returns when the job ends.

The text-only completion is short and self-contained: one instruction line, then for each output a header line such as `**Result 3** · Krea 2 Turbo` directly above its preview image linked to the original, `[![Result 3](…/<id>.jpg)](…/<id>)`. Videos get the header with a View Video link. The agent can render it in one step without calling Result again. Generate, Reuse and Result replies carry only that instruction and markdown, with no JSON echo. `detail: true` adds the full JSON record, and `delivery: preview` returns the same markdown for one output on request. Notification Result waits (`delivery: notification`) are capped at 1500 seconds, below LibreChat's 1800-second background deadline, and other waits at 20 seconds. Earlier Agents that pass 1800 are capped rather than refused. A client Stop or disconnect ends the wait promptly but never cancels the generation; only Cancel does that. Regular chats retrieve results on request. Run `mise run test:mcp` for the native integration and importer tests; `mise run check` includes them too.

Studio's own server instructions and tool descriptions carry every workflow rule, so any MCP client behaves the same: pass the request with kind and tier, Reuse for follow-ups, reply as each result says and never poll. Each reply carries its own collection steps. They also say to use the tools for every image or video asked for, follow the user's instructions and keep replies short, so clients need no prompt prefix. Enable `serverInstructions: true` in LibreChat. The instructions and every tool schema stay within a small budget that a test checks, since chat hosts resend them on every model step. AI Control connections only get the GPU approval rule. MCP catalogue reads reuse the existing backend metadata cache, and studio rescans still refresh it. Completed-result visibility checks target the exact job and keep Hidden/deletion revocation.

Set `MCP_PUBLIC_URL` to the configured browser-reachable HTTP(S) base URL for result downloads. It can include a gateway base path, such as `/studio`, and result links keep that prefix. Without it, links use the studio's local loopback address. Result links are short opaque IDs under `/mcp/results/`, mapped in `mcp-ownership.json` to their owner and output. Adding `.jpg` serves a JPEG preview at most 1024 pixels on its long side. Sealed links issued by earlier versions keep working. Original links open inline in the browser and don't expire, but stop working when outputs are deleted. In multi-user mode, rotating or revoking a personal MCP token leaves existing links valid. Set and preserve `MCP_SIGNING_KEY`, and keep `mcp-ownership.json` in `STUDIO_DATA_DIR` across updates.

Keep shared provider credentials at the trusted gateway, which sets `x-ai-user-id` to partition job and reference ownership. In multi-user mode the gateway can also forward the user's email in `x-ai-user-email`, such as LibreChat's `{{LIBRECHAT_USER_EMAIL}}` passed through LiteLLM's `extra_headers`. An unlinked ID whose email is an enabled account's username is then linked to that account automatically. Other unlinked IDs get tools that only ask for an administrator's link (see [Configuration](docs/guides/CONFIGURATION.md)). Direct provider calls use a separate fallback owner, and the forwarded header alone grants no access.

Generate requires the same account to have fetched Models with the exact profile ID in the past hour, and compact discovery doesn't count. Full model details list only the `controls` a profile lets MCP adjust, with their ranges, options and defaults. Fixed controls are left out, and Generate refuses a fixed control by name and lists the adjustable alternatives. `negative_prompt` only appears where it takes effect. Profiles without a negative input, or guidance-distilled profiles fixed at CFG 1, refuse it with an explanation, and profiles whose default CFG is 1 need a CFG above 1 with it.

Details also index every compatible optional LoRA the account can access, leaving out other architectures, acceleration and supporting files. Each gets one `name — hint [trigger]` line with the shortest name Generate accepts, a hint from the title only when the name doesn't describe the LoRA, and the first trigger word the name doesn't already spell. `lora_query` or `lora_names` returns full picker metadata (title, description, trigger words, recommended strength and range, source link) for up to five LoRAs. Generate accepts LoRA names without their folder, extension or exact case and fills in each LoRA's recommended strength when none is given. It refuses unknown names with the closest matches, and without a `profile_id` it picks a profile that can use the named LoRAs. Studio validation messages, such as a LoRA strength outside its published range, go back to the agent. Refresh guidance after a studio restart.

Full model details include `native` size support. Explicit `width` and `height` request native generation (a 2048-pixel long side for 2K), with tiled decoding for large images. On supported built-in reference models, `reference_role: edit` changes the supplied picture at its framing, and `reference_role: reference` guides a new image at the requested dimensions. Automatic upscaling stays off unless `upscale_quality` is explicitly set.

Profiles and researched guidance live in the sibling AI configuration repository (`../ai`). Maintained profiles carry their selected rules, examples, patterns and sources in `heissUi.prompting`. The model API keeps that guidance and MCP returns it with profile details. Compact discovery returns only its summary and the selected mode/variant identifiers. Explicit `imageModes` guidance overrides the shared profile guidance. For older profiles, you can mount a prompting inventory read-only and set `MCP_PROMPTING_PATH` as a fallback. The native endpoint uses the existing studio generation, reference and result APIs.

The optional AI Control tools need `CONTROL_MCP_API_KEY`, `CONTROL_API_KEY` and `CONTROL_URL` on the instance that exposes them. The control MCP credential must be different from both the media credential and the upstream control API credential. It exposes only GPUStatus, Workloads, Preview, Mode, Apply, Restart and Operation, and media credentials can't discover or call them. Allocation changes need an explicit preview and an approved apply. Mode previews a preset board (`image_text`: text on GPU 0 and image on GPU 1, keeping the running text model when it fits one GPU; `image_video`: image on GPU 0 and video on GPU 1; `video`: video on both GPUs), which Apply then applies with its signature. Restart restarts one running workload in place through AI Control's restart API, with the same model, profile and GPUs; it never starts a stopped workload or changes the allocation.

To keep chat job ownership when replacing the legacy Python bridge, stop both the bridge and the destination studio, then run the offline importer with Node 22.13 or newer. Resolve `MCP_SIGNING_KEY` and the destination studio's `STUDIO_MCP_API_KEY` through the existing credential environment, and never put secret values in command arguments. Run `node server/mcp-import.js --data-dir <studio-data> --database <legacy-jobs.sqlite> --studio primary`, then repeat it for the other studio's data directory with `--studio secondary` and its own provider key. The importer reads the selected studio's legacy SQLite records without changing them, keeps forwarded-user identities and maps the matching studio provider to its native key. It merges compatible owners atomically, skips existing matches, and rejects unknown owners or conflicts before writing anything. Keep the original SQLite database and all studio data. Don't run the importer while either service is writing ownership records.

The source migration doesn't deploy or switch a running service. Deployed bridge state stays as it is until an explicit deployment and ownership import.


#### Prompt Writing

With prompt writing on, Studio writes each final prompt itself. Generate sends the `request` with the target profile's full prompting guide (without its sources, review date or sampling notes) and short instructions to an OpenAI-compatible chat model, in one fresh call per generation that returns one prompt per image: `count: 2` gets two different prompts. Settings, model and count words in the request ("turbo", "landscape", "2K") stay settings. If the call fails, times out after 30 seconds or returns nothing usable, the request itself is the prompt. `exact_prompt: true`, or explicit `prompts`, skip writing. Each reply ends with the prompt each result ran, shortened to 200 characters, and the result page shows it in full. The structured reply's `prompt_source` says `studio`, `request` (the fallback) or `exact`. The log records each call's profile, duration and any fallback reason, never the prompt text.

Studio keeps each MCP job's request beside its ownership record. A Reuse `request` ("warmer", "add snow") or a model change (`tier` or `profile_id` for the same kind, or animating an image) writes a new prompt from the original request plus every change so far, for the target profile. The chat never needs the guide, and no guides pile up in its context.

Set all three settings, or none (prompt writing is then off). A partial setting stops Studio at startup:

- `STUDIO_PROMPT_WRITER_URL`: the OpenAI-compatible base URL, such as `http://litellm.litellm.svc.cluster.local:4000`. Studio adds `/v1/chat/completions` unless the URL already ends with it.
- `STUDIO_PROMPT_WRITER_KEY`: its API key, such as a LiteLLM virtual key limited to the model below.
- `STUDIO_PROMPT_WRITER_MODEL`: a fast model without reasoning, such as `ai/text-quick`.

#### Other Clients

Any Streamable HTTP MCP client (Claude Desktop, Grok, LibreChat or others) can connect in one of two ways:

- **Through LiteLLM:** `https://<litellm>/studio/mcp` with a LiteLLM virtual key that may use the `studio` MCP server in `x-litellm-api-key: Bearer <key>`, and the user's identity in `X-AI-User-Id` (and optionally `X-AI-User-Email`). LiteLLM adds the shared `STUDIO_MCP_API_KEY`. Send `X-Studio-Conversation-Id` too, where the client has a conversation ID, so results are numbered per conversation.
- **Directly:** `https://<studio>/mcp` with the account's personal MCP token from **Settings › Account** as `Authorization: Bearer <token>`.

## Supported models

30 families run out of the box with their makers' recommended settings, and a renamed file is still recognized.

**Image (23):** FLUX.3 Klein (with its prompt upsampler), MOSS-Image (with a guided setup), Krea 2, Anima, Z-Image, Flux.2 (Dev, Klein 4B, Klein 9B), SDXL (NoobAI, Illustrious, Pony and more), Pony V7, Chroma, Qwen-Image (and 2.1), Ideogram 4, MageFlow, ERNIE-Image, Lumina Image 2.0, Sana, HiDream I1, SD 3.5, Flux.1, SD 2.x and SD 1.5.

**Video (7, beta):** MiniMax H3, HunyuanVideo 1.5, Wan 2.2 (5B and 14B) and Wan 2.1, with text and image to video where the model has both.

Missing parts get a Download button. GGUF files work; Nunchaku, NF4 and other formats that need their own loader nodes don't ([formats](./docs/guides/MODELS.md#formats)). Anything else runs as [your own workflow](#bring-your-own-workflow).

## Bring your own workflow

The built-in models cover the everyday loop. For anything custom, bring your graph.

1. **Export.** Build and test the graph in ComfyUI, then export it (**API format** works best; the regular workflow file works too).
2. **Drop.** Open the **Workflow Gallery** from the dock and drop the file on it, or paste the JSON.
3. **Check the connections.** The usual inputs are connected for you. Change any of them under **Change connections**, then import.

The workflow shows up in the model menu under **Your workflows** once the nodes it needs are installed.

The usual inputs (prompt, size, seed, steps and the like) are connected for you, and only those change; everything else runs as exported. The review marks anything it guessed, warns about nodes that run code, touch files or go online, and tells you where a missing model file belongs, with a Download button when it knows the file. To ship a workflow with its connections fixed, see the [workflow guide](./workflows/README.md).

## Auto-downloads

Getting a new model running in ComfyUI usually means hunting for the right text encoder, the right VAE and a custom node pack or two. Here each part gets a button, and **Get all** fetches the lot. Nothing downloads until you press the button. [What's covered](./docs/guides/DOWNLOADS.md).

## Reference and start images

- **Reference images for edit models.** Flux.2 (Klein 4B, Klein 9B and Dev) and Qwen-Image 2.1 edit from reference images.
- **Start images for everything else.** Every other built-in image model (Krea 2, SDXL, Flux, Z-Image and the rest) offers **Add start image**. The image then sits in the sidebar's Basics with **Change from the reference** right under it, for how far the result may move from it.
- **Paint on either one.** Hover a reference or start image and press the brush to [inpaint](#inpainting) just part of it.

<details>
<summary><b>Reference slots, the library and your workflows</b></summary>

- **Slots as you need them.** The composer opens a new reference slot each time you fill one. Several references stack into one chip that fans out on hover.
- **Edit or Reference.** On Flux.2 and Qwen-Image 2.1 the first reference is **Edit** (the result keeps its size and changes that picture) or **Reference** (it only guides, and the size and shape stay yours, 2K included).
- **A reference library in the composer.** Click images to select or deselect them immediately; the picker stays open. Selected images stay first across searches and source tabs, and can still be removed when every slot is filled. Pick from uploads or your own generations, drop files in, or send any image from the viewer. Reuse an image and switch to Video to use that output as the starting reference with its aspect ratio; it replaces the primary video reference and preserves a separate end frame. An upscaled image is used upscaled.
- **Your workflows too.** Imported workflows can take reference images and let one set the output size and aspect.
- **Animate or extend from the viewer.** With a ready MiniMax H3 first-frame video model, **Animate** in the viewer starts a video from that image, and **Extend Video** continues a finished video from its last frame with its prompt. Both open the Animate review, so the prompt can be edited before it queues.

</details>

## Inpainting

Change one part of a picture and keep the rest. Hover a reference or start image in the prompt bar and press the brush, paint over what should change, then write what it becomes.

<p align="center">
  <a href="./docs/screenshots/inpainting.mp4"><img src="./docs/screenshots/inpainting.webp" alt="Inpainting in Studio: a picture is dropped into the prompt bar as a reference, the brush opens the inpaint studio over the gallery, and a stroke is painted over the part to change" width="100%" /></a>
</p>

- **The rest stays untouched.** Only the painted part is redrawn, so the rest never softens or shifts in color.
- **Works with your models.** 18 of the 21 image families inpaint, with no extra nodes. The model menu marks which ones.
- **A proper brush.** Brush, eraser, hand, undo, zoom and size, on a phone too.
- **Two dials.** **Inpaint strength** and **Edge softness** sit under the image in the sidebar (in the Advanced sheet on a phone).

Not for Ideogram 4, MageFlow, Sana, video or imported workflows, and there's no outpainting or layers. Inpainting is in beta and on by default; **Settings › Studio › Inpainting** turns it off.

## Native 2K and sizes

- **Supported native resolutions.** The size menu offers only documented native sizes within the model's limits: 2K draws a 2048-pixel long side and 4K draws 4096, without automatic upscaling. Two choices use buttons; more than two use a dropdown. Models without an additional supported resolution hide that control. [Which models ↗](./docs/guides/MODELS.md#native-2k)
- **See the size before you run.** A live frame shows the shape and pixels you'll get, and hovering a shape previews it.
- **Custom, linked or not.** Width and height move together and keep the shape, or unlink them. Type, use the arrow keys or drag the label, from 256 to 4096.
- **Saved sizes on every device.** **Save size** keeps a size of your own, to rename or remove later. Your phone and every other device see the same list.
- **Or count in megapixels.** **Settings › Studio › Size in Megapixels** puts a Megapixels field in the menu, and every shape is drawn at that many pixels.

A reference being edited or a painted mask sets the size itself, and your 2K pick comes back afterwards.

On desktop, images open at 1:1, with one image pixel per CSS pixel; on a phone they open fitted to the screen. Zoom In, Zoom Out, 1:1 and Fit Whole Image controls are available on desktop and phone. Fit Whole Image shows the entire picture within the viewer without cropping or changing its aspect ratio.

## Smart upscale

Bigger, sharper pictures with [SeedVR2](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler), without leaving the studio.

- **Any picture, one click.** The upscale arrow on a tile or in the viewer takes anything in the gallery to 2K or 4K. The upscale is saved next to the original, and a slider drags across both to show what changed.
- **Time left, not a spinner.** The ring, the buttons and the queue count down the seconds that are left.
- **Set up when you need it.** The first upscale without the SeedVR2 nodes or model offers to install them, with sizes shown before anything downloads. Weights kept in any folder ComfyUI reads are found.

<details>
<summary><b>Effort and faces</b></summary>

**Fast**, **Balanced** (2K) and **High** (4K) trade speed for quality; High is the slowest and uses the most graphics memory. Each generation picks its effort and face detail in **Advanced Settings**, starting from **Settings › Studio**, where Smart Upscale can also be turned off. Face detail runs only with an upscale. The optional **face detail pass** (beta) redraws small faces and needs the Impact Pack and Impact Subpack nodes.

</details>

## Auto-grouping

Making ten takes of one idea fills a gallery fast. With auto-grouping on, pictures from similar prompts, even ones you tweak as you go, fold into one tile once you stop working on them.

- **Stacks with a count.** A stack shows as a photo with two edges under it, or as a cover flow, with the number of pictures in the corner.
- **Skim without opening.** Slide the pointer along the bottom of a stack to flip through it. Open it to spread the pictures out, or **Unstack** to keep them apart.
- **It follows your prompts.** Similar prompts group together, and coming back to a prompt the next day starts a new stack.
- **Your files stay put.** Grouping changes no files. Switch it off and the gallery is as it was.

Turn it on with **Auto-Grouping** in the gallery toolbar (at the end of the filter row on a phone), beside **Grid Autoplay** and **Failed**. **Settings › Studio › Gallery** picks the photo or cover-flow look.

## On your phone

On a phone the studio switches to its own layout. Prompt, browse, share and upscale while your PC renders.

Open the studio's address on the phone and sign in with your account.

<details>
<summary><b>The phone layout</b></summary>

The gallery runs edge to edge under one slim top bar: the status light and "Studio", Images | Videos, Search, Filter and the menu. The prompt bar at the bottom shows your prompt and Generate; a tap on the prompt opens Create, with one row each for Model, References, LoRAs, Size and Advanced; each opens as a small pop-up over Create. Long press a tile to select; the selection's actions sit in a bar at the bottom. In the viewer, pictures open fitted to the screen; pinch or double tap to zoom and swipe or flick to the next picture. Share opens the phone's share sheet. Added to the home screen, it opens full screen.

</details>

## Updating

Deploy a newer container image. Pin a version tag or digest, read its release notes, and keep the `/data` volume: the first start of a new version backs up its settings and records in `/data/.backups/` before migrating them.

## Configuration

Copy `.env.example` to `.env` when you need different ports or paths.

```bash
COMFY_URL=http://127.0.0.1:8188
HOST=127.0.0.1
PORT=8787
STUDIO_DATA_DIR=./data
COMFY_OUTPUT_DIR=
```

Everything else (the output folder, other devices, HTTPS, the Hugging Face token, proxies) is in [CONFIGURATION.md](./docs/guides/CONFIGURATION.md).

## Troubleshooting

[TROUBLESHOOTING.md](./docs/guides/TROUBLESHOOTING.md) covers the common problems. A failed generation links straight to its section.

- **No models showing up?** Make sure ComfyUI is running. On this computer it connects on port 8188 or 8000; anywhere else, set its address in Settings › Workers. New files show once ComfyUI lists them.
- **Asking for help?** **Settings › Maintenance › Copy Diagnostics** copies versions, system and GPU, without prompts or images. Open a [GitHub issue](https://github.com/maxexcloo/studio/issues) with it.

## Feedback

Found a bug in Studio or want a feature? Open a [GitHub issue](https://github.com/maxexcloo/studio/issues).

## FAQ

<details>
<summary><b>Why "Studio"?</b></summary>

It is a hard fork of HEISS UI with its own code and releases, so it has its own name.

</details>

## Development

Install the [shared Mise configuration](https://github.com/maxexcloo/dotfiles#shared-tools--tasks)
before running local Mise tasks.

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and the local API server together, and `npm test` runs the server and script tests. Adding a model family is mostly data: [MODELS.md](./docs/guides/MODELS.md) walks through it. Contributions are welcome. See [CONTRIBUTING.md](./docs/guides/CONTRIBUTING.md), and leave generated media, model files, logs and `.env` files out of commits.

## Credits

Studio is a fork of **[HEISS UI](https://github.com/tristmeister/HEISS-UI)**, which started as a fork of **[J-AI Studio](https://github.com/jasperdevs/J-AI-Studio)** by **[Jasper](https://github.com/jasperdevs)**. The prompt-first idea and much of the foundation are his work. If Studio is useful to you, give both originals a star too.

Built on [ComfyUI](https://github.com/comfyanonymous/ComfyUI).

## License

Studio keeps the [MIT licence](./LICENSE) it inherited; the HEISS UI and J-AI Studio copyright notices stay in it.

The native MCP modules and importer (`server/mcp*.js`, except independently authored tests) retain the [AGPL-3.0 licence](./server/mcp.LICENSE) of the ported MCP service. Both licence texts are preserved in the source and distributed application.

The container image includes an [FFmpeg](https://ffmpeg.org) build (via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)) for video previews. It's licensed separately under the GPL, with its license and source at those links.
