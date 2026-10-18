# HEISS Worker Node

A ComfyUI custom node for running ComfyUI as a stateless worker behind HEISS UI.

With HEISS media storage (on by default in multi-user mode, or `HEISS_OUTPUT_STORAGE=heiss`), HEISS fetches each finished output over ComfyUI's `/view` API into its own per-account storage. It then calls this node to delete ComfyUI's copy, along with any reference images staged for that run only. ComfyUI has no delete API of its own, so this node is what keeps it free of studio data. HEISS and ComfyUI no longer need to share a folder.

## Install

Copy or mount this folder into ComfyUI's `custom_nodes` directory as `heiss_worker`. Mount it read-only where possible. The HEISS container image includes it at `/app/comfyui/heiss_worker`, so a ComfyUI image can copy it from the matching HEISS release:

```dockerfile
COPY --from=ghcr.io/<owner>/heiss-ui@sha256:<digest> /app/comfyui/heiss_worker /root/ComfyUI/custom_nodes/heiss_worker
```

## Endpoints

- `GET /heiss/worker`: version and whether a token is required.
- `POST /heiss/worker/delete`: `{ "files": [{ "type": "output" | "input" | "temp", "subfolder": "…", "filename": "…" }] }`. Up to 256 files per call. Only media files inside ComfyUI's own output, input and temp folders can be deleted. Paths that escape those folders, dot folders and symlinks are refused.

## Token

Set the same `HEISS_WORKER_TOKEN` in ComfyUI's environment and in HEISS's to require it on these endpoints. Without one, the endpoints are as open as the rest of ComfyUI's API, so keep ComfyUI reachable only by HEISS and administrators.

Without this node, HEISS still stores everything in its own storage, but ComfyUI keeps its copies. HEISS logs a warning once per backend.
