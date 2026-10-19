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
  <a href="https://github.com/tristmeister/HEISS-UI"><img src="https://img.shields.io/badge/upstream-HEISS%20UI-ff7a3d?style=for-the-badge&labelColor=1a1a1a" alt="Upstream HEISS UI" /></a>
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

Studio is the [maxexcloo/studio](https://github.com/maxexcloo/studio) fork of HEISS UI, based on upstream [HEISS UI v0.18.0](https://github.com/tristmeister/HEISS-UI/releases/tag/v0.18.0), commit `a0452538d14a74b23e1422e59a9f24b4781f2406`. Fork versions follow an independent numeric Semantic Versioning stream; the upstream base is recorded separately in `server/release-identity.json`.

This fork is delivered only as a container image, `ghcr.io/maxexcloo/studio`. Upstream's desktop downloads, double-click launchers and in-app updater are not part of it; update by deploying a newer image. Upstream model, workflow and studio work is merged in regularly, and fork features (accounts, media storage, MCP, deployment settings) live in separate modules.

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
- **Hidden.** A locked place for images you keep to yourself, opened with Touch ID, Windows Hello or a password. Generate into it, or hide anything later.
- **Civitai-ready images (beta).** New PNGs carry their prompt and settings in a form Civitai fills in for you on upload. Turn it on in Settings › Library.
- **Civitai images & model downloads.** Open **Image & Model Library**, choose **Images** and paste an image link. The full image joins your gallery with its settings and model associations; missing supported model and LoRA files download automatically. **Models** accepts Civitai model and Hugging Face file links.
- **Zen mode.** Just the prompt and the picture, fullscreen.

Open **LoRAs** in the composer to select effects and adjust their strengths. Drag the selected effects by their grips to change the applied order, or use the Up/Down buttons or arrow keys on a grip. **Info** shows available descriptions, trigger words and source links without fetching extra metadata.

LoRA stacks, live previews, video previews, recent prompts and gallery search are on the [HEISS UI website](https://heiss-ui.vercel.app/#features).

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

ComfyUI on another machine or port? Set its address in **Settings › Connection**, or copy `.env.example` to `.env` and set `COMFY_URL`.

</details>

## Containers

The Dockerfile builds a Linux AMD64 image for Docker and Podman. Set `COMFY_URL` to the existing ComfyUI endpoint reachable from the container, then build and run:

```sh
docker build --tag studio:local .
mkdir -p data
docker run --env COMFY_URL --init --publish 127.0.0.1:8787:8787 --rm \
  --user "$(id -u):$(id -g)" --volume "$PWD/data:/data" studio:local
```

Set `COMFY_VIDEO_URL` to a separate ComfyUI HTTP(S) endpoint to route local video workflows there. Images and provider-backed Grok workflows stay on `COMFY_URL`. Job progress, uploads and cancellation follow the selected backend; an unavailable video server never falls back to the primary server. Both backends must share input and output storage for local gallery access. On phones, select **Video** on the **Create** sheet, then choose a video model; duration controls are under **Advanced Settings**.

Open `http://localhost:8787`. `/data` retains settings, galleries, histories and imported workflows. Mount ComfyUI inputs, outputs and model directories separately when a feature needs local file access. The image defaults to UID 1000, exposes port 8787 and includes a health check. It starts the server directly; update the container image to update the application.

CI calls the Container workflow after application and browser checks pass on `main`; the Release workflow does the same for `v*` tags. The Container workflow builds the image, tests the runtime and scans for fixable high or critical vulnerabilities. Successful builds publish to `ghcr.io/<owner>/<repository>` (from `github.repository`) with SBOM and provenance: `latest` and `sha-<full commit>` from `main`, and `X.Y.Z` and `X.Y` from a release tag, whose GitHub release lists the changelog notes and the image digest. Prefer an immutable `sha-<full commit>` or version tag, or the image digest, for deployment.

For local verification, run `mise run setup`, then `mise run check`. Renovate updates actions, base images and npm dependencies; `mise run dependencies:check` previews them.

### Native MCP

Studio serves optional Streamable HTTP MCP at `/mcp` on its existing application port, in the same Node process. Set `STUDIO_MCP_API_KEY` on each studio instance to enable its seven tools: Models, Generate, Status, Result, Cancel, Upload and Reuse. Each key accesses only its own studio. No additional service, Python runtime, studio passwords or other studio URLs are needed. Ordinary requests need no Models call: Generate accepts `kind` and `tier` instead of a `profile_id` and uses the account's default ready profile for that tier, preferring the deployment default and then its family. Tiers come from the profile label: `quality` (Quality), `fast` (Fast), `turbo` (Super Fast) and `standard` (Standard or no tier in the label, otherwise Quality). Models lists profiles compactly (ID, label, kind, tier and a one-line summary), optionally for one tier; Models with a `profile_id` returns the prompting guide, controls, LoRAs and reference slots. Generate waits up to `wait_seconds` for its jobs to finish (by default 30 seconds for images and none for videos, at most 60). When every job finishes in time, it returns `status: done` with the same markdown a background Result notification returns, so quick images need no background Result or second agent turn. Otherwise, or when the client cancels the wait, it returns `status: queued` with, per job, its job ID, a short reference such as `result 3` and a signed watch link. The watch link opens a page that shows progress and then the finished outputs, so users can follow results without the chat. References are numbered per conversation when the client sends `x-studio-conversation-id` (in LibreChat, for example, a header set from the conversation ID placeholder), otherwise per account; Status, Result, Cancel and Reuse accept a reference wherever they accept a job ID. Reuse handles follow-ups such as "again", "more like that" or "animate it" without a Models call. With the result's own `kind`, it runs the result again with the same profile and settings and a new seed; `prompt` replaces the original prompt and `count` defaults to 1. With `kind: video` on an image, it animates the image as the first frame of the account's default first-frame video profile, sized to the image's proportions. Without a `tier`, that is a Fast profile unless the deployment default video profile takes a first frame. While the studio's separate local video worker (`COMFY_VIDEO_URL`) is unavailable, Generate with `kind: video` and Reuse animation without a `profile_id` use a ready provider-backed cloud video profile the account may use instead, such as Grok: the one matching the `tier`, otherwise Standard. Availability comes from the studio's model catalogue, which MCP already caches, so no extra checks run per request. The reply's `profile` carries `remote: true` and its message names the cloud profile, so the agent can tell the user the video went to the cloud. Without such a profile the usual error applies, an explicit `profile_id` is never replaced, and while the worker is up nothing changes. Reuse then replies and waits as Generate does. Without `kind`, it returns the image as a reference asset for Generate. Status and Result return immediately by default. For automatic in-chat delivery of queued jobs, use a saved LibreChat Agent with background execution enabled for Result: call Result once per queued job with `delivery: notification`, `wait_seconds: 1500` and `run_in_background: true`, then end the foreground turn and wait for the notification. The text-only completion is self-sufficient and short: one instruction line, then per output a header line such as `**Result 3** · Krea 2 Turbo · [View Original](…)` directly above its signed image markdown (for videos, the header alone with a View Video link), so the resumed Agent renders it in one step without calling Result again. `detail: true` adds the full JSON record. `delivery: preview` still attaches an inline preview on request. Background (`delivery: notification`) Result waits are capped at 1500 seconds, below LibreChat's 1800-second background deadline, and foreground waits at 20 seconds; earlier Agents that pass 1800 are capped rather than refused. A client Stop or disconnect ends the wait promptly; it never cancels the generation, which only Cancel does. Regular chats retrieve results on request. Run `mise run test:mcp` for the native integration and importer tests; `mise run check` includes them too.

The server instructions carry only the workflow rules: Generate for ordinary requests, Reuse for follow-ups, follow each reply and never poll; each reply carries its own collection steps. Enable `serverInstructions: true` on LibreChat connections without their own prompt; a model spec whose prompt already states these rules can leave it off, since chat hosts resend instructions and tool schemas on every model step. AI Control connections receive only the GPU approval rule. MCP catalogue reads reuse the existing backend metadata cache; studio rescans still refresh it. Completed-result visibility checks target the exact job and retain Hidden/deletion revocation.

Set `MCP_PUBLIC_URL` to the configured browser-reachable HTTP(S) base URL for result downloads. It can include a gateway base path, such as `/studio`; signed links retain that prefix. Without it, links use the studio’s local loopback address. Set and preserve `MCP_SIGNING_KEY` and retain `mcp-ownership.json` in `HEISS_DATA_DIR` across updates. Keep shared provider credentials at the trusted gateway, which sets `x-ai-user-id` to partition job and reference ownership. In multi-user mode the gateway can also forward the user's email in `x-ai-user-email`, such as LibreChat's `{{LIBRECHAT_USER_EMAIL}}` passed on through LiteLLM's `extra_headers`; an unlinked ID whose email is an enabled account's username is then linked to that account automatically, and other unlinked IDs get tools that only ask for an administrator's link (see [Configuration](docs/guides/CONFIGURATION.md)). Direct provider calls use a separate fallback owner; the forwarded header alone grants no access. Original links open inline in the browser, do not expire and stop working when outputs are hidden or deleted. In multi-user mode, rotating or revoking a personal MCP token leaves existing links valid.

Generate requires the same account to fetch Models with the exact profile ID within the preceding hour; compact discovery cannot satisfy this check. Full model details list only the `controls` a profile lets MCP adjust, with their ranges, options and defaults; fixed controls are omitted, and Generate refuses a fixed control by name together with the adjustable alternatives. `negative_prompt` appears only where it takes effect: profiles without a negative input, or guidance-distilled profiles fixed at CFG 1, refuse it with an explanation, and profiles whose default CFG is 1 require a CFG above 1 alongside it. Details also list the profile's compatible optional LoRAs from the studio LoRA picker's metadata (title, description, trigger words, recommended strength and range, source link), excluding other architectures, acceleration and supporting files, and respecting the account's LoRA access; `lora_query` narrows long lists. Studio validation messages, such as a LoRA strength outside its published range, are returned to the agent. Refresh guidance after a studio restart. Full model details include `native` size support. Explicit `width` and `height` request native generation (a 2048-pixel long side for 2K), with tiled decoding for large images. On supported built-in reference models, `reference_role: edit` changes the supplied picture at its framing; `reference_role: reference` guides a new image at the requested dimensions. Automatic upscaling remains off unless `upscale_quality` is explicitly supplied.

Profiles and researched guidance remain in the sibling AI configuration repository (`../ai`). Maintained profiles carry their selected rules, examples, patterns and sources in `heissUi.prompting`; the model API preserves that guidance and MCP returns it with profile details. Compact discovery returns only its summary and selected mode/variant identifiers. Explicit `imageModes` guidance overrides the shared profile guidance. For older profiles, optionally mount a prompting inventory read-only and set `MCP_PROMPTING_PATH` as a fallback. The native endpoint uses the existing studio generation, reference and result APIs.

Optional AI Control tools require `CONTROL_MCP_API_KEY`, `CONTROL_API_KEY` and `CONTROL_URL` on the instance that exposes them. The control MCP credential must differ from the media credential and the upstream control API credential. It exposes only GPUStatus, Workloads, Preview, Apply and Operation; media credentials cannot discover or invoke them. Allocation changes require an explicit preview and approved apply.

To preserve chat job ownership when replacing the legacy Python bridge, stop both the bridge and destination studio before running the offline importer with Node 22.13 or newer. Resolve `MCP_SIGNING_KEY` and the destination studio’s `STUDIO_MCP_API_KEY` through the existing credential environment; never put secret values in command arguments. Run `node server/mcp-import.js --data-dir <studio-data> --database <legacy-jobs.sqlite> --studio primary`, then repeat for the other studio’s data directory with `--studio secondary` and its own provider key. The importer reads the selected studio’s legacy SQLite records without modifying them, preserves forwarded-user identities and maps the matching studio provider to its native key. It atomically merges compatible owners, skips existing matches, and rejects unknown owners or conflicts before writing. Keep the original SQLite database and all studio data. Do not run the importer while either service is writing ownership records.

The source migration does not deploy or switch a running service. Existing deployed bridge state remains unchanged until an explicit deployment and ownership import.


## Supported models

30 families run out of the box with their makers' recommended settings, and a renamed file is still recognized.

**Image (23):** FLUX.3 Klein (with its prompt upsampler), MOSS-Image (with a guided setup), Krea 2, Anima, Z-Image, Flux.2 (Dev, Klein 4B, Klein 9B), SDXL (NoobAI, Illustrious, Pony and more), Pony V7, Chroma, Qwen-Image (and 2.1), Ideogram 4, MageFlow, ERNIE-Image, Lumina Image 2.0, Sana, HiDream I1, SD 3.5, Flux.1, SD 2.x and SD 1.5.

**Video (7, beta):** MiniMax H3, HunyuanVideo 1.5, Wan 2.2 (5B and 14B) and Wan 2.1, with text and image to video where the model has both.

Missing parts get a Download button. An unrecognized file can be given a type under **Settings › Models › Model types**. GGUF files work; Nunchaku, NF4 and other formats that need their own loader nodes don't ([formats](./docs/guides/MODELS.md#formats)). Anything else runs as [your own workflow](#bring-your-own-workflow).

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

Not for Ideogram 4, MageFlow, Sana, video or imported workflows, and there's no outpainting or layers. Inpainting is in beta and on by default; **Settings › Features › Inpainting** turns it off.

## Native 2K and sizes

- **Supported native resolutions.** The size menu offers only documented native sizes within the model's limits: 2K draws a 2048-pixel long side and 4K draws 4096, without automatic upscaling. Two choices use buttons; more than two use a dropdown. Models without an additional supported resolution hide that control. [Which models ↗](./docs/guides/MODELS.md#native-2k)
- **See the size before you run.** A live frame shows the shape and pixels you'll get, and hovering a shape previews it.
- **Custom, linked or not.** Width and height move together and keep the shape, or unlink them. Type, use the arrow keys or drag the label, from 256 to 4096.
- **Saved sizes on every device.** **Save size** keeps a size of your own, to rename or remove later. Your phone and every other device see the same list.
- **Or count in megapixels.** **Settings › Generation › Size in megapixels** puts a Megapixels field in the menu, and every shape is drawn at that many pixels.

A reference being edited or a painted mask sets the size itself, and your 2K pick comes back afterwards.

On desktop, images open at 1:1, with one image pixel per CSS pixel; on a phone they open fitted to the screen. Zoom In, Zoom Out, 1:1 and Fit Whole Image controls are available on desktop and phone. Fit Whole Image shows the entire picture within the viewer without cropping or changing its aspect ratio.

## Smart upscale

Bigger, sharper pictures with [SeedVR2](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler), without leaving the studio.

- **Any picture, one click.** The upscale arrow on a tile or in the viewer takes anything in the gallery to 2K or 4K, Hidden included. The upscale is saved next to the original, and a slider drags across both to show what changed.
- **Time left, not a spinner.** The ring, the buttons and the queue count down the seconds that are left.
- **Set up when you need it.** The first upscale without the SeedVR2 nodes or model offers to install them, with sizes shown before anything downloads. Weights kept in any folder ComfyUI reads are found.

<details>
<summary><b>Effort and faces</b></summary>

**Fast**, **Balanced** (2K) and **High** (4K) trade speed for quality; High is the slowest and uses the most graphics memory. The effort is set under **Settings › Features › Smart upscale**, where it can also be turned off. The optional **face detail pass** (beta) redraws small faces and needs the Impact Pack and Impact Subpack nodes.

</details>

## Auto-grouping

Making ten takes of one idea fills a gallery fast. With auto-grouping on, pictures from similar prompts, even ones you tweak as you go, fold into one tile once you stop working on them.

- **Stacks with a count.** A stack shows as a photo with two edges under it, or as a cover flow, with the number of pictures in the corner.
- **Skim without opening.** Slide the pointer along the bottom of a stack to flip through it. Open it to spread the pictures out, or **Unstack** to keep them apart.
- **It follows your prompts.** Similar prompts group together, and coming back to a prompt the next day starts a new stack.
- **Your files stay put.** Grouping changes no files. Switch it off and the gallery is as it was.

Turn it on with the stack button next to gallery search, or under **Settings › Library › Auto-grouping**, where you also pick the photo or cover-flow look.

## On your phone

On a phone the studio switches to its own layout. Prompt, browse, share and upscale while your PC renders.

Set up [LAN access](#connect-over-lan) first, then scan the QR code shown in **Settings › Connection** with your phone and sign in. Both devices need to be on the same trusted network.

<details>
<summary><b>The phone layout</b></summary>

The gallery runs edge to edge, and one **Describe…** pill opens the prompt, reference images (with Edit or Reference in plain sight), workflow, size (Default, 2K, Custom and your saved sizes) and number of images, with Advanced one link away. The brush on a reference opens the inpaint studio for your finger. Long press a tile to Share, Upscale, Star, Use these settings, Hide or Delete. In the viewer, pictures open fitted to the screen; pinch or double tap to zoom and swipe or flick to the next picture. Share opens the phone's share sheet. Added to the home screen, it opens full screen. A ring around Generate shows progress while you browse.

**Use the full studio** under More switches a phone to the complete layout.

</details>

## Connect over LAN

Use a laptop, tablet, phone or another desktop on the same local network to prompt, browse the gallery and upscale. Studio and ComfyUI keep running on your PC with its models and outputs; the other device needs only a browser.

1. On the PC running Studio, open **Settings › Connection** and turn on **Open on other devices**.
2. In the same settings, set a **studio password** under **Signing in**.
3. On your other device, open the **network address** shown in Connection (for example, `http://192.168.1.20:8787`) and sign in with that password. Use your PC’s listed address, not `localhost`.

Laptops and desktops get the full studio and phones get the phone layout. Only enable access on a network you trust. Admin controls stay at the PC unless you allow them for signed-in devices.

<details>
<summary><b>More on setup</b></summary>

**Open on other devices** takes effect the next time Studio starts. For a single session, start it with `npm start -- --lan` instead. The container listens on all addresses (`HOST=0.0.0.0`), so publish its port only where other devices should reach it.

</details>

Signing in, admin rights, HTTPS and proxies are covered in [SECURITY.md](./docs/guides/SECURITY.md#other-devices-signing-in-admin-https-and-proxies).

## Hidden

Hidden is a place for the images you'd rather keep to yourself. Open it from the lock in the dock. The first time, it walks you through a password and, where the browser supports it, Touch ID or Windows Hello.

- **Generate straight into it.** Anything made while Hidden is open renders there, with the same live previews, and stays out of the gallery.
- **Hide from the gallery.** The eye on a tile (or in the viewer) moves an image into Hidden, or back out. Upscale, compare, remix and video all work inside it.
- **Locked means out of sight.** A locked Hidden shows no thumbnails and no count, and its prompts stay out of Recent prompts. It locks after a while without activity (Settings › Hidden › Auto-lock), or right away with **Lock**.

Images, prompts, settings and upscales in Hidden are encrypted on disk with a key that only your password or a passkey can open, and ComfyUI's own copies are removed. Hidden keeps things out of casual view; it isn't forensic-grade protection. [SECURITY.md](./docs/guides/SECURITY.md) has the details, including what passkeys need.

There's no password reset. If the password and every passkey are lost, **Erase Hidden** in Settings › Hidden starts over and takes everything in Hidden with it.

## Updating

Deploy a newer container image. Pin a version tag or digest, read its release notes, and keep the `/data` volume: the first start of a new version backs up its settings and records in `/data/.backups/` before migrating them.

## Configuration

Copy `.env.example` to `.env` when you need different ports or paths.

```bash
COMFY_URL=http://127.0.0.1:8188
HOST=127.0.0.1
PORT=8787
HEISS_DATA_DIR=./data
COMFY_OUTPUT_DIR=
```

Everything else (the output folder, other devices, HTTPS, the Hugging Face token, proxies) is in [CONFIGURATION.md](./docs/guides/CONFIGURATION.md).

## Troubleshooting

[TROUBLESHOOTING.md](./docs/guides/TROUBLESHOOTING.md) covers the common problems. A failed generation links straight to its section.

- **No models showing up?** Make sure ComfyUI is running. On this computer it connects on port 8188 or 8000; anywhere else, set its address in Settings › Connection. After adding files, use **Settings › Models › Rescan**.
- **Asking for help?** **Settings › About › Copy diagnostics** copies versions, system and GPU, without prompts or images. Open a [GitHub issue](https://github.com/maxexcloo/studio/issues) with it.

## Feedback and community

Found a bug in Studio or want a feature? Open a [GitHub issue](https://github.com/maxexcloo/studio/issues).

The in-app **Idea or bug?** and **Report bug** links post to upstream's [HEISS UI feedback board](https://heiss-ui.vercel.app/board/), for problems that also affect upstream HEISS UI. Upstream also has a [Discord](https://discord.gg/Hf7ysvDeGa).

## FAQ

The [HEISS UI website FAQ](https://heiss-ui.vercel.app/#faq) answers the common questions.

<details>
<summary><b>Why "Studio"?</b></summary>

It is a separately delivered fork of HEISS UI, so it has its own name. _Heiß_ is German for hot, hence the steaming cup it keeps.

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

The upstream application retains its [MIT licence](./LICENSE). The original J-AI Studio copyright notice is kept alongside HEISS UI’s.

The native MCP modules and importer (`server/mcp*.js`, except independently authored tests) retain the [AGPL-3.0 licence](./server/mcp.LICENSE) of the ported MCP service. Both licence texts are preserved in the source and distributed application.

The container image includes an [FFmpeg](https://ffmpeg.org) build (via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)) for video previews. It's licensed separately under the GPL, with its license and source at those links.
