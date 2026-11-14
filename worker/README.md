# Studio Worker

Build from the Studio checkout with `docker build -f worker/Dockerfile -t studio-worker .`.
The image contains ComfyUI, the Radiance bridge, Studio custom nodes and isolated
Radiance libraries. `source.json` pins ComfyUI; `sources.json` pins custom nodes.
Studio's custom nodes live in `comfyui/` and are copied directly from this
checkout into `/root/ComfyUI/custom_nodes/` during the worker build.

The image starts ComfyUI on port 8188 with arguments from `CLI_ARGS`. Supply
model directories and GPU placement in the deployment, owned by kubelab.

Studio starts and stops workers by scaling their Kubernetes deployments between 0
and 1 replicas; see
[runtime control](../README.md#runtime-control) for
the labels and annotations a deployment needs and the service account role.
Workers without them stay unmanaged. Media output saving retains admission until
finished, so a switch waits for it.

CPU checks: `node --test backend/runtime/*.test.ts` and `mise run test:python`; no
GPU is needed. GPU startup and actual inference need separate deployment
verification.
