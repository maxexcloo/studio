# Studio Worker Node

A ComfyUI custom node for running ComfyUI as a stateless worker behind Studio.

Studio fetches each finished output over ComfyUI's `/view` API into its own per-account storage. It then calls this node to delete ComfyUI's copy, along with any reference images staged for that run only. ComfyUI has no delete API of its own, so this node is what keeps it free of studio data. Studio and ComfyUI no longer need to share a folder.

## Install

The [Studio worker image](../../README.md) includes this node at
`/root/ComfyUI/custom_nodes/studio_worker`. For another ComfyUI installation,
copy or mount this directory into its `custom_nodes` directory as `studio_worker`.
Mount it read-only where possible.

## Endpoints

- `GET /studio/worker`: version and whether a token is required.
- `POST /studio/worker/delete`: `{ "files": [{ "type": "output" | "input" | "temp", "subfolder": "…", "filename": "…" }] }`. Up to 256 files per call. Only media files inside ComfyUI's own output, input and temp folders can be deleted. Paths that escape those folders, dot folders and symlinks are refused.
- `GET /studio/worker/models`: configured model files, partial transfers and available disk space.
- `POST /studio/worker/models/file`: `{ "folder": "loras", "file": "example.safetensors", "action": "stat" }`. Actions are `stat`, `hash`, `discard`, explicit `replace` and `remove`; replacement preserves the original as a `.previous.*` file, and `remove` (Library updates) deletes an installed model only when its SHA-256 matches the `sha256` given.
- `PUT /studio/worker/models/upload`: streamed weights with `folder`, `file`, `offset`, `size` and `sha256` query parameters. `X-Studio-Model-Metadata` contains ASCII-escaped JSON with a source fingerprint and resume validators. Transfers require a published SHA-256 checksum, stay below 256 GiB and never overwrite an existing destination. Partial bytes resume only when their source, checksum and total size match.

Model endpoints always require a nonempty matching token. Give the worker with
the `models` capability a writable models mount.
Studio keeps Civitai and Hugging Face credentials and fetches the provider;
only weight bytes and safe resume metadata reach this node. No provider URL or
credential is stored in its sidecar files. Configured ComfyUI folder aliases and
extra model roots are respected; new files enter the first configured root.
Allowed folders are checkpoints, clip_vision, diffusion_models, loras,
text_encoders and vae. Only `.safetensors` and `.gguf` files are accepted.

Local model storage remains the default. In worker mode, a local mirror mount
is never used for downloads; use Downloads for the active worker library.

## Token

Set the same `STUDIO_WORKER_TOKEN` in ComfyUI's environment and in Studio's.
Without one, only the media deletion endpoint retains its existing open-worker
behaviour; model inventory and mutations are refused. Keep ComfyUI reachable
only by Studio and administrators.

Without this node, Studio still stores everything in its own storage, but ComfyUI keeps its copies. Studio logs a warning once per backend.
