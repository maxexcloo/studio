# Studio Worker Node

A ComfyUI custom node for running ComfyUI as a stateless worker behind Studio.

With Studio media storage (on by default in multi-user mode, or `STUDIO_OUTPUT_STORAGE=studio`), Studio fetches each finished output over ComfyUI's `/view` API into its own per-account storage. It then calls this node to delete ComfyUI's copy, along with any reference images staged for that run only. ComfyUI has no delete API of its own, so this node is what keeps it free of studio data. Studio and ComfyUI no longer need to share a folder.

## Install

Copy or mount this folder into ComfyUI's `custom_nodes` directory as `studio_worker`. Mount it read-only where possible. The Studio container image includes it at `/app/comfyui/studio_worker`, so a ComfyUI image can copy it from the matching Studio release:

```dockerfile
COPY --from=ghcr.io/maxexcloo/studio:<version> /app/comfyui/studio_worker /root/ComfyUI/custom_nodes/studio_worker
```

## Endpoints

- `GET /studio/worker`: version and whether a token is required.
- `POST /studio/worker/delete`: `{ "files": [{ "type": "output" | "input" | "temp", "subfolder": "…", "filename": "…" }] }`. Up to 256 files per call. Only media files inside ComfyUI's own output, input and temp folders can be deleted. Paths that escape those folders, dot folders and symlinks are refused.

## Token

Set the same `STUDIO_WORKER_TOKEN` in ComfyUI's environment and in Studio's to require it on these endpoints. Without one, the endpoints are as open as the rest of ComfyUI's API, so keep ComfyUI reachable only by Studio and administrators.

Without this node, Studio still stores everything in its own storage, but ComfyUI keeps its copies. Studio logs a warning once per backend.
