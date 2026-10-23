# Troubleshooting

Check the interface status and Queue for the affected job's state and reason. When reporting a problem, include the Studio version, selected profile, worker and error message. Keep credentials and private media out of [public issues](https://github.com/maxexcloo/studio/issues).

## Connection & Configuration

### Studio Cannot Reach a Worker

Check the configured addresses in **Settings › Workers**, then inspect that worker's container logs and network access. Worker addresses must be reachable from the Studio server. A waiting job keeps its selected backend; it does not silently switch providers.

Deployment configuration owns worker placements and model paths; Studio owns editable runtime profiles. See [Configuration](CONFIGURATION.md) and [Worker Operations](worker/README.md). Lifecycle switching remains disabled until the required ownership and text-admission cutover is complete.

### Studio Does Not Start

Read the startup error for the missing setting, occupied port or invalid mounted configuration. Use the container's published address; local development uses the Vite address printed by `mise run dev`. Source development requires the Node.js version in `package.json`; the application image includes its runtime.

### Profiles or Models Are Missing

Check the live profile and catalogue definitions in Library, and confirm that `STUDIO_CONFIG_DIR` mounts the intended ai seed and workload configuration. Existing runtime edits take precedence over seeds. Check worker model mounts separately; model files and required custom nodes must exist on the selected worker.

### Chat Is Unavailable

Check the Chat status and administrator-configured gateway endpoint, key and allowed model list. Keep gateway credentials server-side. The account must have prompt-assistant access, and a media request still needs permission for its selected profile. See [Configuration](CONFIGURATION.md).

## Generation Failures

Retry a failed job through Queue after addressing its reason. If provider acceptance or output saving is uncertain, inspect the recorded job before submitting again: the provider may still be running or the result may already exist.

### A model file is damaged or incomplete

A download may have stopped early or saved a web page instead of the model. Replace the named file with a complete copy on the worker and retry.

### The GPU ran out of memory

Try a smaller size, fewer outputs or a lighter profile. Check other workloads on the same GPU. Do not stop a worker while accepted jobs are running or outputs are being saved.

<a name="comfyui-does-not-have-a-file-this-run-asked-for"></a>

### ComfyUI can't find a file this run uses

ComfyUI returned "Value not in list". Check that the profile's model, LoRA, text encoder and VAE filenames match the selected worker's files and model paths. Correct the owned configuration or worker mount, then refresh the worker's model list.

<a name="parts-that-do-not-fit-together"></a>

### A LoRA doesn't fit this model

Remove the named LoRA or select one for the profile's model family. Radiance reports incompatible adapter modules directly. LoRAs are grouped by family and type in the picker.

### A part doesn't match the model

The text encoder, VAE or LoRA belongs to another model family. Check the profile definition and selected LoRAs together.

### A file went missing

A file was moved or deleted after the worker listed it. Restore it at the configured path or correct the profile, then refresh the worker's model list.

### ComfyUI-GGUF can't load this model yet

The installed ComfyUI-GGUF does not support this architecture. Use a supported model format or update the worker recipe to a compatible node version and verify it before deployment.

### A node is missing in ComfyUI

The workflow requires a custom node absent from the worker. Check the worker recipe and source pins, rebuild and verify the worker image, then restart it after active work and output saving finish.

### ComfyUI dropped this run

The recorded run is absent from the provider's queue and history. Check for a worker restart or cleared history. Confirm it cannot still complete before retrying; Studio does not adopt unrelated worker history.

### Lost the connection to ComfyUI

Inspect worker health, logs and connectivity. An offline worker does not prove a generation stopped. Studio recovers recorded provider jobs after restart before deciding whether work can be retried.

### No image was saved

Check that the workflow ends in an output node such as Save Image. If the provider produced an output but Studio cannot save it, check the Studio media mount, free space and permissions. Keep the provider output until Studio has saved its copy.

### Needs a separate part

The selected checkpoint needs an external text encoder or VAE. Add the required file to the worker and update the profile's references in **Library › Profiles**.

### Generation failed

Inspect the job's error and worker logs. Check that the workflow runs with the selected model and installed nodes. Include the error and relevant configuration names in an issue, with credentials and private content removed.

## References, Upscaling & Library

References can be selected from the gallery, uploaded or dragged from gallery items into generation controls. Masking and video input require a profile that supports those operations; changing profile can change the available controls.

Upscaling uses the durable queue. Check the job reason and worker's upscaler models and nodes if it fails. The original result remains available.

For missing or gated Library downloads, verify the catalogue link, model licence and worker storage. Configure any required Hugging Face token server-side as described in [Configuration](CONFIGURATION.md). A full disk or inaccessible mount must be corrected before retrying a download.

## Accounts & Devices

Use the deployment's published address from `STUDIO_ALLOWED_HOSTS`. Sign in with the account's email and password or configured single sign-on. Administrators manage approval, disabled accounts and permissions in **Settings › Accounts**. Password changes invalidate other sessions; too many failed sign-ins temporarily delay further attempts.

Single-user development and access from another device use the options described in [Configuration](CONFIGURATION.md). Keep container port bindings, proxy configuration and host validation consistent.

## Updating & Rollback

Follow [Container Operations](DOCKER.md#updating--rollback). Back up and rehearse migration and restoration before cutover. Reverting an image alone does not restore SQLite metadata; stop Studio and restore the matching protected metadata backup with its media. Keep the previous deployment until the rewritten workflows and existing result links are verified.
