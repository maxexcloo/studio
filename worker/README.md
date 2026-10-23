# Studio Worker

Build from the Studio checkout with `docker build -f worker/Dockerfile -t studio-worker .`.
The image contains ComfyUI, the Radiance bridge, Studio custom nodes and isolated
Radiance libraries. `source.json` pins ComfyUI; `sources.json` pins custom nodes.
Studio's custom nodes live in `comfyui/` and are copied directly from this
checkout into `/root/ComfyUI/custom_nodes/` during the worker build.

Deployment configuration belongs to `ai`. Run an ordinary container with a fixed
GPU placement, mounted model directories and the existing shared lease directory
mounted at `/run/ai-gpu`. Set `AI_GPU_DEVICES` and `HIP_VISIBLE_DEVICES` to the same
physical placement (`0`, `1` or `0,1`). Lease files must remain shared with AI Control
until it relinquishes ownership; never replace or delete them during a transition.

The default `media` command starts ComfyUI on port 8188 and retains compatible
loaded models. `text` followed by Radiance arguments starts standalone Radiance
through its isolated loader. Supply model paths, listening address, port and
credentials in deployment configuration. The lease wrapper reserves the placement
before either mode starts and holds it until graceful shutdown finishes.

Studio controls only configured existing Docker containers through the forwarded
Engine API. Automatic lifecycle control starts disabled. Enable it only after
AI Control relinquishes ownership and all managed local text traffic reaches
Studio's authenticated admission endpoint. Bifrost must call
`/api/local-text/v1/chat/completions`; Studio's target is the direct Radiance
worker, with its own server-side key. Pointing that target at Bifrost would create
a routing loop. Active streams and media output saving retain admission until
finished. Idle containers stay warm.

Set `STUDIO_CONFIG_DIR` to the read-only `ai` mount and `STUDIO_DOCKER_URL` to
the forwarded Docker Engine HTTP endpoint. Workloads without `studio` metadata
remain unmanaged. Each managed `workloads.json` record adds a `studio` object:

```json
{
  "container": "configured-container-name",
  "placement": "0",
  "url": "http://direct-worker:8188"
}
```

The placement must be one of that record's existing `placements`. Text workers
also set `apiKeyEnv` to the name of the environment variable holding their
Radiance credential. Studio checks HTTP readiness before admission. A failed
or starting worker leaves jobs waiting and does not stop independent workloads.

Set `STUDIO_TEXT_WORKLOAD` to the text workload identifier and
`STUDIO_TEXT_ADMISSION_TOKEN` to the separate bearer credential used by Bifrost.
The browser never receives either credential. Configure `BIFROST_URL` when used;
Studio refuses to target that gateway origin as a worker.

After the ownership and routing transition is verified, lifecycle switching
requires all three explicit values: `STUDIO_RUNTIME_AUTOMATIC=1`,
`STUDIO_RUNTIME_OWNERSHIP_ACKNOWLEDGED=1` and
`STUDIO_TEXT_ADMISSION_ACKNOWLEDGED=1`. These are deployment acknowledgements,
not settings exposed to app users. Runtime status is administrator-only at
`/api/runtime`; text admission uses its own bearer authentication.

CPU checks: `node --test backend/runtime/*.test.ts` and
`python3 -m unittest discover -s worker -p 'test_*.py'`. Lease tests require Linux
`flock`; no GPU is needed. The worker workflow performs packaging smoke checks
and image scanning before publication. A GPU startup and actual inference remain
separate deployment verification.
