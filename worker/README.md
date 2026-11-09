# Studio Worker

Build from the Studio checkout with `docker build -f worker/Dockerfile -t studio-worker .`.
The image contains ComfyUI, the Radiance bridge, Studio custom nodes and isolated
Radiance libraries. `source.json` pins ComfyUI; `sources.json` pins custom nodes.
Studio's custom nodes live in `comfyui/` and are copied directly from this
checkout into `/root/ComfyUI/custom_nodes/` during the worker build.

The deployment lives in kubelab. The image starts ComfyUI on port 8188 with the
arguments in `CLI_ARGS` and retains compatible loaded models. Supply model
directories and the GPU placement in the deployment.

The image sets `HSA_TOOLS_DISABLE_REGISTER=1` to prevent ROCm from consuming a
CPU core per idle worker. This disables HSA profiler/tool registration; override
the variable to `0` when profiling with ROCm tools.

Studio starts and stops workers by scaling their Kubernetes deployments between 0
and 1 replicas; see
[runtime control](../CONFIGURATION.md#queue-sessions--runtime-control) for
the labels and annotations a deployment needs and the service account role.
Workers without them stay unmanaged. Media output saving retains admission until
finished, so a switch waits for it. Idle workers keep running unless Park When
Idle parks them.

Studio refuses to target its text gateway's origin (`STUDIO_ASSISTANT_URL`) as a
worker.

Automatic lifecycle control (Settings › Workers › Automatic Control) never stops or starts
text workers; only an administrator's change in Settings › Workers or the control
MCP tools does. Runtime status and control are administrator-only at
`/api/runtime`.

CPU checks: `node --test backend/runtime/*.test.ts` and `mise run test:python`; no
GPU is needed. The worker workflow performs bridge and packaging smoke checks
before publication. A GPU startup and actual inference remain separate deployment
verification.
