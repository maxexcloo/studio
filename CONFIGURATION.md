# Configuration

Run one Studio replica. Two schedulers must not control the same workers or SQLite database. Mount a writable data directory and use exact [released image versions](https://github.com/maxexcloo/studio/releases).

The [config directory](config/) holds the samples: a [Docker Compose file](config/compose.yaml), a [Kubernetes manifest](config/kubernetes.yaml), an [environment file](config/studio.env.example), the [LibreChat server entry](config/librechat.yaml) and the [sample profiles](config/profiles/). Copy the files you need and keep your deployment's settings and credentials outside this repository.

Studio reads process environment variables first, then its settings file on startup: `/data/.env` in the image, `.env` in the data folder under `mise run dev`, or the file `STUDIO_ENV_FILE` names. Use `NAME=value` on each line and write JSON values without shell quotes. Values an administrator saves in **Settings** apply at once; a value supplied by the deployment appears locked there. [Settings](#settings) lists every `STUDIO_*` setting.

## Docker

On a Linux host, copy [compose.yaml](config/compose.yaml) and [studio.env.example](config/studio.env.example), saved as `.env`, into one folder and run `docker compose up -d`. For the [`docker run` quick start](README.md#run-with-docker), pass `--env-file .env` in place of `-e HOST=127.0.0.1`. Recreate the container with the same data volume after changing the file.

Without host networking (Docker Desktop, or published ports), no browser reaches Studio over loopback, so single-user mode answers nobody. Set `STUDIO_MULTI_USER=1`, then create the recovery administrator inside the container; it asks for the password twice without echoing it:

```sh
docker exec -it studio node backend/commands/create-admin.mjs --email you@example.com
```

The environment example points to a ComfyUI server on the same Linux host. Edit the worker URL for your installation, or follow the [Radiance setup](#radiance). Chat integrations and the prompt assistant are optional.

## Kubernetes

Start from [kubernetes.yaml](config/kubernetes.yaml): a one-replica Deployment with the `Recreate` strategy, a persistent volume at `/data`, a Service on port 8787 and probes on `/api/ping` (liveness) and `/api/ready` (readiness). Supply credentials through a Secret. Forward the pod's port with `kubectl port-forward deployment/studio 8787:8787` and open <http://127.0.0.1:8787> to set up the first administrator, then set `STUDIO_ALLOWED_HOSTS` and add your HTTPS ingress.

### Runtime Control

Set `STUDIO_WORKERS` to connect directly to an existing worker Service. To give Studio control of GPU placement, set `STUDIO_KUBERNETES_NAMESPACES` and let it discover deployments labelled `studio.excloo.dev/kind` (`image` or `video`). Studio scales those deployments between zero and one replicas. `STUDIO_KUBERNETES_GPUS` gives the GPUs per node pool.

```dotenv
STUDIO_KUBERNETES_GPUS={"gpu":2,"gaming":1}
STUDIO_KUBERNETES_NAMESPACES=comfyui-image,comfyui-video,radiance
STUDIO_LOCAL_TEXT_MODEL=local/auto
```

Each deployment's name is its workload id, its node selector names its pool, its resource claim templates give its GPUs, and the one Service selecting its pods gives its address. Optional `studio.excloo.dev/` annotations add `label`, `worker`, `capabilities` and `backend` (`radiance` for a Radiance worker). A `text` capability means the workload serves `STUDIO_LOCAL_TEXT_MODEL` while it runs (through the gateway), and `vision: "true"` that its text models read images. Studio sends `STUDIO_RADIANCE_KEY`, when set, to Radiance as its API key. Anything missing or ambiguous stops Studio at start with the deployment's name; restart Studio after changing a workload. Its service account needs the Role in the [Kubernetes sample](config/kubernetes.yaml) in each of those namespaces. `STUDIO_KUBERNETES_URL` (such as `kubectl proxy`) replaces it for local development.

With `STUDIO_BENCHMARK_IMAGE` (a [BetterBench](https://github.com/GGZ14/BetterBench) image), administrators can benchmark available local text models in **Settings › Workers**. Studio runs them one at a time as Jobs in the workload's namespace. Its network policy must admit pods labelled `app.kubernetes.io/name: betterbench`. `STUDIO_BENCHMARK_SECRET` names the Secret in that namespace which holds the workload's key in `API_KEY`. Give Studio's service account permission to create, get and delete Jobs and list pods there.

Administrators choose the running workloads in **Settings › Workers**.

## Workers

Studio connects directly to ComfyUI and Radiance workers. It saves outputs to `STUDIO_MEDIA_DIR` (`<STUDIO_DATA_DIR>/media` by default) without a shared worker mount. For the packaged ComfyUI worker, set the same `STUDIO_WORKER_TOKEN` on Studio and the worker. See [Studio Worker](worker/README.md).

Studio discovers image and video workers when [Runtime Control](#runtime-control) is enabled and `STUDIO_WORKERS` is unset. To supply worker addresses directly, use a JSON array on one line in `STUDIO_WORKERS`. The [environment example](config/studio.env.example) has one worker. Add an object for each worker reachable from Studio, or use `[]` to run with no workers.

Keep each `id` stable (it defaults to the lower-case name): jobs, previews, cancellation and recovery follow a job's worker by id. Capabilities are `image`, `video`, `upscale` and `models`; the `models` worker holds the model library and receives downloads, so mount its models read-write. `"backend": "radiance"` marks a Radiance worker (the default is `comfyui`).

`<STUDIO_DATA_DIR>/config/models.json` pins the models a deployment expects: a JSON array of `{ "path", "sha256", "size", "url"? }`, each `path` relative to ComfyUI's model folder. `STUDIO_MODEL_MANIFEST_PREFIX` strips a deployment folder (such as `models/comfyui/`) from those paths.

Administrators set the default profiles in **Settings › Studio** and Dream's delays and account overrides in **Settings › Dream** under Administration; accounts choose Cloud or Local for Dream in **Settings › Where Work Runs**. [Settings](#settings) lists the matching variables.

### Radiance

1. Start [Radiance](https://radiance.stilldeadco.de/docs/#40-the-configuration-file) with an image or video model. Make its server address reachable from Studio. On the same host with the Docker quick start, its default port is `8000`.
2. Add the worker to `STUDIO_WORKERS` in Studio's settings file and restart Studio. When Radiance requires an API key, set the matching `STUDIO_RADIANCE_KEY` in Studio.

   ```dotenv
   STUDIO_WORKERS=[{"id":"radiance","name":"Radiance","backend":"radiance","url":"http://127.0.0.1:8000","capabilities":["image"]}]
   ```

3. In **Library › Profiles**, open **Qwen Image 2.1** or use **Import Workflow** to open the [Radiance image sample](config/profiles/radiance-qwen-image.json) if the profile is missing. In **Advanced JSON**, set `graph["1"].inputs.model` to the model ID Radiance returns from `/v1/models`. Choose **Create** or **Save**, then select the profile in Generate. Add the `video` capability only when the worker serves a video model and you have a matching Studio video profile.

This path uses Radiance's own media API. Install the [ComfyUI worker](worker/README.md) separately if you need ComfyUI workflows, model downloads or conversions.

## Cloud Models

`STUDIO_CLIPROXYAPI_URL` and `STUDIO_CLIPROXYAPI_KEY` point Studio at CLIProxyAPI, which it calls directly. A cloud profile is a workflow whose every mode is one `GrokMedia` node, listed only while the provider advertises its model; `STUDIO_CLIPROXYAPI_IMAGE_MODEL` and `STUDIO_CLIPROXYAPI_VIDEO_MODEL` pick the model for a profile that names none. Groups grant Cloud Models per account.

## Accounts & Single Sign-On

`STUDIO_MULTI_USER=1` turns on accounts. Create the recovery administrator from a browser connected directly over loopback (or with [`create-admin`](#docker)), then add accounts in **Settings › Users** and grant features in **Settings › Groups**. Without it, Studio is single-user and answers only direct loopback connections.

For the [Docker quick start](README.md#run-with-docker), set `STUDIO_MULTI_USER=1` in `.env` and create the administrator at <http://127.0.0.1:8787> before adding a TLS proxy. Keep the same data volume when recreating the container. `STUDIO_ALLOWED_HOSTS` lists the public hostnames Studio answers to, separated by commas. See [Security](SECURITY.md) for the trust rules.

Single sign-on (Pocket ID or another OpenID Connect provider) needs `STUDIO_OIDC_ISSUER`, `STUDIO_OIDC_CLIENT_ID` and `STUDIO_OIDC_REDIRECT_URI` (`https://<studio>/api/accounts/oidc/callback`); `STUDIO_OIDC_CLIENT_SECRET` serves confidential clients and `STUDIO_OIDC_LABEL` names the button. Setting only some stops Studio at start. `/?password=1` keeps the password form reachable. The provider decides who may sign in; roles and groups never come from it.

`/api/ping` (liveness) and `/api/ready` (the data folder is writable) answer without an account.

## MCP & Chat Gateway

MCP clients reach `/mcp` in one of three ways:

- **Personal token:** an account's own token from Settings › Account, where only that account can view and copy it again, as `Authorization: Bearer <token>`, or in the path (`/mcp/<token>`) for a client that sends no headers. Only an administrator's own token reaches the admin tools.
- **Trusted gateway:** a chat gateway such as Bifrost (for LibreChat) sends `STUDIO_MCP_API_KEY` with its user's ID in `x-ai-user-id` (and email in `x-ai-user-email`, which links or creates the matching ordinary account). Administrators link other IDs in **Settings › Users › Chat Gateway**. `x-studio-conversation-id` scopes result numbers to one chat, and `x-studio-turn-id` (LibreChat's `{{LIBRECHAT_BODY_PARENTMESSAGEID}}`) groups each turn's results; result links open them in Studio's gallery.
- **GPU control:** `STUDIO_CONTROL_MCP_API_KEY` gets only the GPU tools (`gpu_status`, `workloads`, `preview`, `apply`, `mode`, `restart`, `operation`) and needs [Runtime Control](#runtime-control).

`STUDIO_MCP_PUBLIC_URL` is the internet-facing host: it takes only personal tokens, and signed result, upload and export links use it. The shared keys work only on the other allowed hosts, such as the in-cluster service name.

`node backend/chat-uploads.js`, run beside LibreChat, saves each image a person attaches in chat as their Upload. It watches `STUDIO_CHAT_IMAGES_DIR` and sends new images to `STUDIO_MCP_URL` with `STUDIO_MCP_API_KEY`. Automatic attachment import requires the chat integration. A direct client can call `upload_link` and pass the returned asset IDs when generating.

Every MCP action calls the route its UI action calls with the caller's own credential, so ownership, group features and administrator checks apply as in the app.

`STUDIO_CHAT_URL` (such as `https://chat.example.com`) adds a Chat item to the navigation that opens that chat site in a new tab; unset, there is none.

`STUDIO_REDLIB_URL` (such as `https://reddit.example.com`) is the [Redlib](https://github.com/redlib-org/redlib) front end that importing a Reddit post reads from; unset, that import is refused.

### LibreChat Without a Gateway

Enable Studio accounts and create a personal MCP token in **Settings › Account**. In [LibreChat MCP Settings](https://www.librechat.ai/docs/features/mcp), add `https://studio.example.com/mcp` as Streamable HTTP with a Bearer API key supplied by each user. From other remote MCP clients, use the same URL and send the token as `Authorization: Bearer <token>`.

To share the server definition across users, merge the [sample server entry](config/librechat.yaml) into your `librechat.yaml` and replace the URL. Each LibreChat user supplies their own Studio token. The example passes conversation and turn IDs so Studio can group result links. See [LibreChat's MCP server settings](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers).

### Open WebUI

In Open WebUI's administrator settings, open **Integrations › External Tool Servers** and add a connection.

| Field          | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Type           | MCP (Streamable HTTP)                                   |
| Server URL     | `https://studio.example.com/mcp`                        |
| Authentication | Bearer                                                  |
| Key            | A Studio personal MCP token from **Settings › Account** |

Use an ordinary Studio account for this shared connection. Every authorised Open WebUI user of that connection acts through the same Studio account. Enable the tool server in a chat and try "List the image models available in Studio". Use a tool-capable chat model. See [Open WebUI's MCP setup](https://docs.openwebui.com/features/extensibility/mcp/).

## Prompt Assistant

The optional prompt assistant accepts an OpenAI-compatible Chat Completions endpoint directly or through Bifrost. Set `STUDIO_ASSISTANT_URL`, `STUDIO_ASSISTANT_KEY` and `STUDIO_ASSISTANT_CLOUD_MODEL` to the endpoint's URL, key and model ID. Leave all three unset to run Studio without the assistant. With managed local text workloads, `STUDIO_LOCAL_TEXT_MODEL` supplies their model ID.

**Background AI** (**Settings › Studio**) has a switch for each call Studio makes on its own; [Settings](#settings) lists their variables. Face Check (about 260 MB) and Image Search (about 690 MB) download their CPU models into the data folder on first use.

## Downloads & Imports

Library › Imports downloads to the `models` worker. `CIVITAI_API_TOKEN` and `HF_TOKEN` open restricted files and stay on the server; `HF_ENDPOINT` points Hugging Face downloads at a mirror; with `NODE_USE_ENV_PROXY=1`, Node sends Studio's requests through `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`, except the image and video links Import › From URL fetches, which connect directly so Studio can refuse private addresses.

## Profiles, Guides & Catalogue

Studio's data folder is the only source of live definitions: profiles in `workflows/`, prompting guides in `guides/` and catalogue changes in `library/`. Administrators edit, approve, export and revert them in Library; every edit keeps a version.

When a data folder first starts, Studio copies the [sample profiles](config/profiles/) into its workflows and records their first versions. An existing Library retains the profiles you installed, edited or removed. The [sample profiles' page](config/profiles/README.md) describes the profile format.

## Data & Migrations

`studio.sqlite` in the data folder holds the queue, sessions, accounts, the gallery and the other runtime records; profiles, guides, `config/models.json`, `library/catalogue.json` and media stay files. Studio refuses to start on a folder whose storage predates the current format and names what is pending.

Data moves only through `migrate-runtime`: dry-run, then apply. Run the command with Studio stopped; administrators can also apply the steps that are safe while Studio runs through `POST /api/maintenance/migrations` (`{ "apply": true }` applies). Studio keeps no backups of its data.

```sh
node backend/commands/migrate-runtime.mjs --data-dir /path/to/studio-data
node backend/commands/migrate-runtime.mjs --data-dir /path/to/studio-data --apply
```

The dry run reports mappings, counts and conflicts; a conflict stops the apply and the command exits non-zero. A step is removed once the live data folder has applied it, so an older folder needs `migrate-runtime` from each release that still had its pending steps; Git history keeps them. `backend/runtime-migrations.js` lists the pending steps; each step's module says what it changes.

## Settings

`HOST` and `PORT` set the listening address: `0.0.0.0:8787` in the image, else `127.0.0.1:8787`. A setting with a Settings section can also be saved there unless the deployment sets it. Switches take `1` or `0`.

| Setting                               | Purpose                                                                                     | Default                                      | Settings               |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------- |
| `STUDIO_ALLOWED_HOSTS`                | Hostnames Studio answers to, comma-separated ([Accounts](#accounts--single-sign-on))        | localhost and this machine's addresses       |                        |
| `STUDIO_ASSISTANT_CLOUD_MODEL`        | Prompt assistant model ID ([Prompt Assistant](#prompt-assistant))                           | none                                         |                        |
| `STUDIO_ASSISTANT_KEY`                | Prompt assistant API key                                                                    | none                                         |                        |
| `STUDIO_ASSISTANT_URL`                | Prompt assistant Chat Completions endpoint                                                  | none: no assistant                           |                        |
| `STUDIO_BENCHMARK_IMAGE`              | BetterBench image for text model benchmarks ([Runtime Control](#runtime-control))           | none: no benchmarks                          |                        |
| `STUDIO_BENCHMARK_SECRET`             | Secret holding the benchmarked workload's key in `API_KEY`                                  | none                                         |                        |
| `STUDIO_CARD_IMAGES`                  | MCP `generate` also sends the images of the outfit and scene cards its shots name           | `0`                                          |                        |
| `STUDIO_CHAT_IMAGES_DIR`              | Folder `chat-uploads.js` watches ([MCP & Chat Gateway](#mcp--chat-gateway))                 | required by `chat-uploads.js`                |                        |
| `STUDIO_CHAT_URL`                     | Chat site the navigation's Chat item opens                                                  | none: no Chat item                           |                        |
| `STUDIO_CLIPROXYAPI_IMAGE_MODEL`      | Image model for a cloud profile that names none ([Cloud Models](#cloud-models))             | the provider's advertised Grok image model   |                        |
| `STUDIO_CLIPROXYAPI_KEY`              | CLIProxyAPI key                                                                             | required with `STUDIO_CLIPROXYAPI_URL`       |                        |
| `STUDIO_CLIPROXYAPI_URL`              | CLIProxyAPI base URL                                                                        | none: no cloud models                        |                        |
| `STUDIO_CLIPROXYAPI_VIDEO_MODEL`      | Video model for a cloud profile that names none                                             | the provider's advertised Grok video model   |                        |
| `STUDIO_CONTROL_MCP_API_KEY`          | Key for the MCP GPU control tools                                                           | none                                         |                        |
| `STUDIO_DATA_DIR`                     | Data folder                                                                                 | `/data` in the image, else `data/`           |                        |
| `STUDIO_DEFAULT_IMAGE_PROFILE`        | Profile ID new image drafts start on                                                        | the first ready profile                      | Studio                 |
| `STUDIO_DEFAULT_TEXT_PROFILE`         | Text model for prompt writing and other text work                                           | the gateway's default                        | Studio                 |
| `STUDIO_DEFAULT_VIDEO_PROFILE`        | Profile ID new video drafts start on                                                        | the first ready profile                      | Studio                 |
| `STUDIO_DREAM_IMAGE_IDLE_MINUTES`     | Minutes after an account's latest generation request before Dream makes its images          | `0`                                          | Dream (Administration) |
| `STUDIO_DREAM_IMAGE_SWITCH_MINUTES`   | Minutes the shared queue must be idle before Dream changes local image models or LoRAs      | `2`                                          | Dream (Administration) |
| `STUDIO_DREAM_OVERRIDE_ENABLED`       | Dream on or off for every account                                                           | each account's choice                        | Dream (Administration) |
| `STUDIO_DREAM_OVERRIDE_IMAGE_BACKEND` | `local` or `cloud` for every account's Dream images                                         | each account's choice                        | Dream (Administration) |
| `STUDIO_DREAM_OVERRIDE_SPICY`         | Uncensored on or off for every account                                                      | each account's choice                        | Dream (Administration) |
| `STUDIO_DREAM_OVERRIDE_VIDEO_BACKEND` | `local` or `cloud` for every account's Dream videos                                         | each account's choice                        | Dream (Administration) |
| `STUDIO_DREAM_VIDEO_IDLE_MINUTES`     | Minutes after an account's latest generation request before Dream makes its videos          | `5`                                          | Dream (Administration) |
| `STUDIO_ENV_FILE`                     | Settings file read on startup                                                               | `/data/.env` in the image, else `.env`       |                        |
| `STUDIO_FACE_CHECK`                   | Compare the face in each character result with the character's                              | `1`                                          | Studio                 |
| `STUDIO_FACE_REDO`                    | Run a recent result Face Check marks as drifted once more                                   | `1`                                          | Studio                 |
| `STUDIO_GALLERY_CAPTIONS`             | Caption and tag new images for gallery search                                               | `1`                                          | Studio                 |
| `STUDIO_GALLERY_TITLES`               | Title finished images and videos                                                            | `1`                                          | Studio                 |
| `STUDIO_GALLERY_WHILE_BUSY`           | Run gallery work while Studio is generating                                                 | `0`                                          | Studio                 |
| `STUDIO_IMAGE_SEARCH`                 | Gallery search also finds images that look like the words                                   | `1`                                          | Studio                 |
| `STUDIO_KUBERNETES_GPUS`              | GPUs per node pool, as JSON                                                                 | required with `STUDIO_KUBERNETES_NAMESPACES` |                        |
| `STUDIO_KUBERNETES_NAMESPACES`        | Namespaces whose labelled deployments Studio controls ([Runtime Control](#runtime-control)) | none: no runtime control                     |                        |
| `STUDIO_KUBERNETES_URL`               | Kubernetes API address, such as `kubectl proxy`                                             | the in-cluster API                           |                        |
| `STUDIO_LOCAL_TEXT_MODEL`             | Gateway model ID that text workloads serve                                                  | required with a `text` workload              |                        |
| `STUDIO_MCP_API_KEY`                  | Shared key for a trusted chat gateway and `chat-uploads.js`                                 | none                                         |                        |
| `STUDIO_MCP_PUBLIC_URL`               | Internet-facing base URL for personal tokens and signed links                               | the address Studio is reached at             |                        |
| `STUDIO_MCP_SIGNING_KEY`              | Key that signs result, upload and export links                                              | generated and kept in the data folder        |                        |
| `STUDIO_MCP_URL`                      | Studio's MCP address for `chat-uploads.js`                                                  | required by `chat-uploads.js`                |                        |
| `STUDIO_MEDIA_DIR`                    | Where outputs are saved                                                                     | `<STUDIO_DATA_DIR>/media`                    |                        |
| `STUDIO_MODEL_LIBRARY_URL`            | Model library worker that receives downloads ([Studio Worker](worker/README.md))            | the `models` worker                          |                        |
| `STUDIO_MODEL_MANIFEST_PREFIX`        | Folder stripped from `config/models.json` paths ([Workers](#workers))                       | none                                         |                        |
| `STUDIO_MULTI_USER`                   | `1` turns on accounts ([Accounts](#accounts--single-sign-on))                               | single-user                                  |                        |
| `STUDIO_NEXT_STEPS`                   | Prepare suggestions for finished images and videos                                          | `1`                                          | Studio                 |
| `STUDIO_OIDC_CLIENT_ID`               | Single sign-on client ID                                                                    | none: no single sign-on                      |                        |
| `STUDIO_OIDC_CLIENT_SECRET`           | Single sign-on client secret, for confidential clients                                      | none                                         |                        |
| `STUDIO_OIDC_ISSUER`                  | Single sign-on issuer URL                                                                   | none                                         |                        |
| `STUDIO_OIDC_LABEL`                   | Single sign-on button label                                                                 | Single Sign-On                               |                        |
| `STUDIO_OIDC_REDIRECT_URI`            | `https://<studio>/api/accounts/oidc/callback`                                               | none                                         |                        |
| `STUDIO_PROMPT_IDEAS`                 | Offer ideas in the composer's AI menu                                                       | `1`                                          | Studio                 |
| `STUDIO_RADIANCE_KEY`                 | API key Studio sends to Radiance                                                            | none                                         |                        |
| `STUDIO_REDLIB_URL`                   | Redlib front end for Reddit imports                                                         | none: Reddit imports refused                 |                        |
| `STUDIO_SELF_REVIEW`                  | Score recent images against their owner's rules and brief                                   | `1`                                          | Studio                 |
| `STUDIO_SUGGESTED_PROMPTS`            | Write prompts for uploads and other items without one                                       | `1`                                          | Studio                 |
| `STUDIO_TASTE_UPDATES`                | Summarise each account's taste as it rates                                                  | `1`                                          | Studio                 |
| `STUDIO_WORKERS`                      | Workers as a JSON array ([Workers](#workers))                                               | discovered by runtime control, else none     |                        |
| `STUDIO_WORKER_TOKEN`                 | Token shared with the packaged ComfyUI worker                                               | none                                         |                        |

## Troubleshooting

Check the interface status and Queue for the affected job's state and reason. When reporting a problem, include the Studio version, selected profile, worker and error message. Keep credentials and private media out of [public issues](https://github.com/maxexcloo/studio/issues).

### Connection & Configuration

#### Studio Cannot Reach a Worker

Check the configured addresses in **Settings › Workers**, then inspect that worker's container logs and network access. Worker addresses must be reachable from the Studio server. A waiting job keeps its selected backend; it does not silently switch providers.

Deployment configuration owns worker placements and model paths; Studio owns editable runtime profiles. See [Workers](#workers) and [Studio Worker](worker/README.md).

#### Studio Does Not Start

Read the startup error for the missing setting, occupied port or invalid mounted configuration.

#### Profiles or Models Are Missing

Check the live profile and catalogue definitions in Library. Check worker model mounts separately; model files and required custom nodes must exist on the selected worker.

### Generation Failures

Retry a failed job through Queue after addressing its reason. If provider acceptance or output saving is uncertain, inspect the recorded job before submitting again: the provider may still be running or the result may already exist.

#### A model file is damaged or incomplete

A download may have stopped early or saved a web page instead of the model. Replace the named file with a complete copy on the worker and retry.

#### The GPU ran out of memory

Try a smaller size, fewer outputs or a lighter profile. Check other workloads on the same GPU. Do not stop a worker while accepted jobs are running or outputs are being saved.

<a name="comfyui-does-not-have-a-file-this-run-asked-for"></a>

#### ComfyUI can't find a file this run uses

ComfyUI returned "Value not in list". Check that the profile's model, LoRA, text encoder and VAE filenames match the selected worker's files and model paths. Correct the owned configuration or worker mount, then refresh the worker's model list.

<a name="parts-that-do-not-fit-together"></a>

#### A LoRA doesn't fit this model

Remove the named LoRA or select one for the profile's model family. Radiance reports incompatible adapter modules directly. LoRAs are grouped by family and type in the picker.

#### A part doesn't match the model

The text encoder, VAE or LoRA belongs to another model family. Check the profile definition and selected LoRAs together.

#### A file went missing

A file was moved or deleted after the worker listed it. Restore it at the configured path or correct the profile, then refresh the worker's model list.

#### ComfyUI-GGUF can't load this model yet

The installed ComfyUI-GGUF does not support this architecture. Use a supported model format or update the worker recipe to a compatible node version and verify it before deployment.

#### A node is missing in ComfyUI

The workflow requires a custom node absent from the worker. Check the worker recipe and source pins, rebuild and verify the worker image, then restart it after active work and output saving finish.

#### ComfyUI dropped this run

The recorded run is absent from the provider's queue and history. Check for a worker restart or cleared history. Confirm it cannot still complete before retrying; Studio does not adopt unrelated worker history.

#### Lost the connection to ComfyUI

Inspect worker health, logs and connectivity. An offline worker does not prove a generation stopped. Studio recovers recorded provider jobs after restart before deciding whether work can be retried.

#### No image was saved

Check that the workflow ends in an output node such as Save Image. If the provider produced an output but Studio cannot save it, check the Studio media mount, free space and permissions. Keep the provider output until Studio has saved its copy.

#### Needs a separate part

The selected checkpoint needs an external text encoder or VAE. Add the required file to the worker and update the profile's references in **Library › Profiles**.

#### Generation failed

Inspect the job's error and worker logs. Check that the workflow runs with the selected model and installed nodes. Include the error and relevant configuration names in an issue, with credentials and private content removed.

### References, Upscaling & Library

Masking and video input require a profile that supports those operations; changing profile can change the available controls.

Upscaling uses the durable queue. Check the job reason and worker's upscaler models and nodes if it fails. The original result remains available.

For missing or gated Library downloads, verify the catalogue link, model licence and worker storage. Configure any required Hugging Face token server-side as described in [Downloads & Imports](#downloads--imports). A full disk or inaccessible mount must be corrected before retrying a download.

### Accounts & Devices

Use the deployment's published address from `STUDIO_ALLOWED_HOSTS`. Sign in with the account's email and password or configured single sign-on. Too many failed sign-ins temporarily delay further attempts.

Single-user mode answers only the computer running Studio; other devices need account mode ([Accounts & Single Sign-On](#accounts--single-sign-on)). Keep container port bindings, proxy configuration and host validation consistent.
