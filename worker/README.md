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

Studio starts and stops workers by scaling their Kubernetes deployments between 0
and 1 replicas; see
[runtime control](../CONFIGURATION.md#queue-sessions--runtime-control) for
`STUDIO_KUBERNETES_WORKLOADS` and the service account role it needs. Workers that
are not listed stay unmanaged. Active streams and media output saving retain
admission until finished, so a switch waits for them. Idle workers stay warm.

Managed local text reaches Studio's authenticated admission endpoint: Bifrost
calls `/api/local-text/v1/chat/completions`, and Studio's target is the direct
Radiance worker with its own server-side key (the workload's `apiKeyEnv`).
Pointing that target at Bifrost would create a routing loop. Set
`STUDIO_TEXT_WORKLOAD` to the text workload identifier and
`STUDIO_TEXT_ADMISSION_TOKEN` to the separate bearer credential used by Bifrost.
The browser never receives either credential. Configure `BIFROST_URL` when used;
Studio refuses to target that gateway origin as a worker.

Automatic lifecycle control (`STUDIO_RUNTIME_AUTOMATIC=1`) also needs
`STUDIO_TEXT_ADMISSION_ACKNOWLEDGED=1`, confirming that all managed local text
traffic reaches that endpoint before Studio stops text workers on its own. These
are deployment acknowledgements, not settings exposed to app users. Runtime
status and control are administrator-only at `/api/runtime`; text admission uses
its own bearer authentication.

CPU checks: `node --test backend/runtime/*.test.ts` and
`python3 -m unittest discover -s worker -p 'test_*.py'`. Lease tests require Linux
`flock`; no GPU is needed. The worker workflow performs bridge, lease and packaging
smoke checks before publication. A GPU startup and actual inference remain
separate deployment verification.
