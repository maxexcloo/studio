# Configuration

Run one Studio replica. Two schedulers must not control the same workers or SQLite database. Mount a writable data directory and use exact [released image versions](https://github.com/maxexcloo/studio/releases).

Studio reads process environment variables first, then its settings file on startup. The Docker image reads `/data/.env` and a source checkout reads `.env` in the project folder. Docker's `--env-file` can also supply process environment variables. Values an administrator saves in **Settings** apply at once. A value from the environment appears locked there.

```bash
HOST=127.0.0.1
PORT=8787
STUDIO_DATA_DIR=./data
```

`STUDIO_ALLOWED_HOSTS` lists the extra names Studio answers to (comma-separated); TLS terminates at the proxy in front of it. See [Security](SECURITY.md).

## Workers

Studio connects directly to ComfyUI and Radiance workers. It saves outputs to `STUDIO_MEDIA_DIR` (`<STUDIO_DATA_DIR>/media` by default) without a shared worker mount. For the packaged ComfyUI worker, set the same `STUDIO_WORKER_TOKEN` on Studio and the worker. See [Studio Worker](worker/README.md).

On Kubernetes, leave `STUDIO_WORKERS` unset: the image and video workloads Studio finds are its workers (see [Runtime Control](#runtime-control)). Elsewhere, `STUDIO_WORKERS` lists them; `[]` runs Studio with no workers, and a malformed value stops it at start:

```bash
STUDIO_WORKERS='[
  {"id": "primary", "name": "Primary", "url": "http://comfyui-primary:8188", "capabilities": ["image", "video", "upscale", "models"]},
  {"id": "secondary", "name": "Secondary", "url": "http://comfyui-secondary:8188", "capabilities": ["image", "video", "upscale"]}
]'
```

With the [Docker quick start](README.md#run-with-docker), use `http://127.0.0.1:8188` for a ComfyUI worker on the same Linux host. Worker URLs must be reachable from Studio. For the packaged worker, model mounts and downloads, see [Studio Worker](worker/README.md).

Keep each `id` stable (it defaults to the lower-case name): jobs, previews, cancellation and recovery follow a job's worker by id. Capabilities are `image`, `video`, `upscale` and `models`; the `models` worker holds the model library and receives downloads, so mount its models read-write. `"backend": "radiance"` marks a Radiance worker (the default is `comfyui`).

`<STUDIO_DATA_DIR>/config/models.json` pins the models a deployment expects: a JSON array of `{ "path", "sha256", "size", "url"? }`, each `path` relative to ComfyUI's model folder. `STUDIO_MODEL_MANIFEST_PREFIX` strips a deployment folder (such as `models/comfyui/`) from those paths.

`STUDIO_DEFAULT_IMAGE_PROFILE` and `STUDIO_DEFAULT_VIDEO_PROFILE` pick a fresh composer's profiles (else the first ready one).

### Radiance

1. Start [Radiance](https://radiance.stilldeadco.de/docs/#40-the-configuration-file) with an image or video model. Make its server address reachable from Studio. On the same host with the Docker quick start, its default port is `8000`.
2. Add the worker to `STUDIO_WORKERS` in Studio's settings file and restart Studio. When Radiance requires an API key, set the matching `STUDIO_RADIANCE_KEY` in Studio.

   ```dotenv
   STUDIO_WORKERS='[{"id":"radiance","name":"Radiance","backend":"radiance","url":"http://127.0.0.1:8000","capabilities":["image"]}]'
   ```

3. In **Library › Profiles**, import the [Radiance image sample](backend/samples/radiance-qwen-image.json) if it is missing. Set its model ID to the name Radiance returns from `/v1/models` and select the profile in Images. Add the `video` capability only when the worker serves a video model and you have a matching Studio video profile.

This path uses Radiance's own media API. Install the [ComfyUI worker](worker/README.md) separately if you need ComfyUI workflows, model downloads or conversions.

## Cloud Models

`STUDIO_CLIPROXYAPI_URL` and `STUDIO_CLIPROXYAPI_KEY` point Studio at CLIProxyAPI, which it calls directly. A cloud profile is a workflow whose every mode is one `GrokMedia` node, listed only while the provider advertises its model; `STUDIO_CLIPROXYAPI_IMAGE_MODEL` and `STUDIO_CLIPROXYAPI_VIDEO_MODEL` pick the model for a profile that names none. Groups grant Cloud Models per account.

## Accounts & Single Sign-On

`STUDIO_MULTI_USER=1` turns on accounts. Create the recovery administrator from a browser connected directly over loopback, then add accounts in **Settings › Users** and grant features in **Settings › Groups**. Without it, Studio is single-user and answers only direct loopback connections.

For a Docker host network deployment, start with the [Docker quick start](README.md#run-with-docker) and add `-e STUDIO_MULTI_USER=1` before the image name. Create the administrator at <http://127.0.0.1:8787> before adding a TLS proxy. Keep the same data volume when recreating the container, and set `STUDIO_ALLOWED_HOSTS` to the proxy's public hostname. See [Security](SECURITY.md) for the trust rules.

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

To share the server definition across LibreChat users, define it in [`librechat.yaml`](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers). Each user enters their own Studio token.

```yaml
mcpServers:
  studio:
    type: streamable-http
    url: https://studio.example.com/mcp
    requiresOAuth: false
    startup: false
    apiKey:
      source: user
      authorization_type: bearer
    requestHeaders:
      X-Studio-Conversation-Id: "{{LIBRECHAT_BODY_CONVERSATIONID}}"
      X-Studio-Turn-Id: "{{LIBRECHAT_BODY_PARENTMESSAGEID}}"
```

## Prompt Assistant

The optional prompt assistant accepts an OpenAI-compatible Chat Completions endpoint directly or through Bifrost. Set `STUDIO_ASSISTANT_URL`, `STUDIO_ASSISTANT_KEY` and `STUDIO_ASSISTANT_CLOUD_MODEL` to the endpoint's URL, key and model ID. Leave all three unset to run Studio without the assistant. With managed local text workloads, `STUDIO_LOCAL_TEXT_MODEL` supplies their model ID.

**Background AI** (**Settings › Maintenance**) has a switch for each call Studio makes on its own, each on by default; `0` turns it off: `STUDIO_FACE_CHECK`, `STUDIO_FACE_REDO`, `STUDIO_GALLERY_CAPTIONS`, `STUDIO_GALLERY_TITLES`, `STUDIO_IMAGE_SEARCH`, `STUDIO_NEXT_STEPS`, `STUDIO_PROMPT_IDEAS`, `STUDIO_SUGGESTED_PROMPTS` and `STUDIO_TASTE_UPDATES`. Face Check (about 260 MB) and Image Search (about 690 MB) download their CPU models into the data folder on first use. `STUDIO_GALLERY_WHILE_BUSY=1` lets that work run while Studio is generating.

`mise run eval:assistant` replays the recorded cases in `backend/fixtures/assistant-evals/` against the live gateway; `--record` writes the replies back for review.

## Characters

`STUDIO_CARD_IMAGES=1` (off by default, until a live proof run) sends the images of the outfit and scene cards that MCP `generate`'s shots name as references, after the character's.

## Downloads & Imports

Library › Imports downloads to the `models` worker. `CIVITAI_API_TOKEN` and `HF_TOKEN` open restricted files and stay on the server; `HF_ENDPOINT` points Hugging Face downloads at a mirror; with `NODE_USE_ENV_PROXY=1`, Node sends Studio's requests through `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`, except the image and video links Import › From URL fetches, which connect directly so Studio can refuse private addresses.

## Profiles, Guides & Catalogue

Studio's data folder is the only source of live definitions: profiles in `workflows/`, prompting guides in `guides/` and catalogue changes in `library/`. Administrators edit, approve, export and revert them in Library; every edit keeps a version.

A profile can run one model on Radiance or ComfyUI. Its `studio` block holds the shared fields, the backend it runs on and each backend's own block, whose fields replace the shared ones of the same name:

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

## Data & Migrations

`studio.sqlite` in the data folder holds the queue, sessions, accounts, the gallery and the other runtime records; profiles, guides, `config/models.json`, `library/catalogue.json` and media stay files. Studio refuses to start on a folder whose storage predates the current format and names what is pending.

Data moves only through `migrate-runtime`: dry-run, then apply. Run the command with Studio stopped; administrators can also apply the steps that are safe while Studio runs through `POST /api/maintenance/migrations` (`{ "apply": true }` applies). Studio keeps no backups of its data.

```sh
node backend/commands/migrate-runtime.mjs --data-dir /path/to/studio-data
node backend/commands/migrate-runtime.mjs --data-dir /path/to/studio-data --apply
```

The dry run reports mappings, counts and conflicts; a conflict stops the apply and the command exits non-zero. A step is removed once the live data folder has applied it, so an older folder needs `migrate-runtime` from each release that still had its pending steps; Git history keeps them. `backend/runtime-migrations.js` lists the pending steps; each step's module says what it changes.

For the Radiance 2 cutover, version profiles through the administrator editor first. With dispatch held for every account and accepted work finished, `POST /api/maintenance/radiance-queue` previews the exact waiting-job model and worker changes. Apply with `{ "apply": true, "baseHash": "<preview hash>" }`; conflicts or a changed queue refuse the entire apply, and the response confirms that other fields and queue order were preserved. Keep the hold until the profiles, workers and waiting jobs have been checked together.

`--dream-owner <account id>` removes Dream answers and taste signals about other accounts' results; supply it only for the one account that used Dream.

## Runtime Control

On Kubernetes, Studio scales its GPU workloads between 0 and 1 replicas itself. At start it finds the deployments labelled `studio.excloo.dev/kind` (`image` or `video`) in `STUDIO_KUBERNETES_NAMESPACES`; `STUDIO_KUBERNETES_GPUS` gives the GPUs per node pool:

```bash
STUDIO_KUBERNETES_GPUS='{"gpu": 2, "gaming": 1}'
STUDIO_KUBERNETES_NAMESPACES=comfyui-image,comfyui-video,radiance
STUDIO_LOCAL_TEXT_MODEL=local/auto
```

Each deployment's name is its workload id, its node selector names its pool, its resource claim templates give its GPUs, and the one Service selecting its pods gives its address. Optional `studio.excloo.dev/` annotations add `label`, `worker`, `capabilities` and `backend` (`radiance` for a Radiance worker). A `text` capability means the workload serves `STUDIO_LOCAL_TEXT_MODEL` while it runs (through the gateway), and `vision: "true"` that its text models read images. Studio sends `STUDIO_RADIANCE_KEY`, when set, to Radiance as its API key. Anything missing or ambiguous stops Studio at start with the deployment's name; restart Studio after changing a workload. Its service account needs, in each namespace, to list deployments, Services and `resourceclaimtemplates`, read pods and their logs, and update `deployments/scale`. `STUDIO_KUBERNETES_URL` (such as `kubectl proxy`) replaces it for local development.

With `STUDIO_BENCHMARK_IMAGE` (a [BetterBench](https://github.com/GGZ14/BetterBench) image), administrators can benchmark a running workload's local text from Settings › Workers: Studio runs a Job in the workload's namespace whose pods are labelled `app.kubernetes.io/name: betterbench`, so its network policy must admit them. The benchmark names `STUDIO_LOCAL_TEXT_MODEL` without its gateway provider (`auto`), which the workload serves. `STUDIO_BENCHMARK_SECRET` names the Secret there whose `API_KEY` is the workload's key. The service account also needs to create, get and delete Jobs and list pods in that namespace.

Administrators choose the running workloads in **Settings › Workers**.

## Troubleshooting

Check the interface status and Queue for the affected job's state and reason. When reporting a problem, include the Studio version, selected profile, worker and error message. Keep credentials and private media out of [public issues](https://github.com/maxexcloo/studio/issues).

### Connection & Configuration

#### Studio Cannot Reach a Worker

Check the configured addresses in **Settings › Workers**, then inspect that worker's container logs and network access. Worker addresses must be reachable from the Studio server. A waiting job keeps its selected backend; it does not silently switch providers.

Deployment configuration owns worker placements and model paths; Studio owns editable runtime profiles. See [Configuration](#configuration) and [Worker Operations](worker/README.md).

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

For missing or gated Library downloads, verify the catalogue link, model licence and worker storage. Configure any required Hugging Face token server-side as described in [Configuration](#configuration). A full disk or inaccessible mount must be corrected before retrying a download.

### Accounts & Devices

Use the deployment's published address from `STUDIO_ALLOWED_HOSTS`. Sign in with the account's email and password or configured single sign-on. Too many failed sign-ins temporarily delay further attempts.

Single-user mode answers only the computer running Studio; other devices need account mode ([Accounts & Single Sign-On](#accounts--single-sign-on)). Keep container port bindings, proxy configuration and host validation consistent.
