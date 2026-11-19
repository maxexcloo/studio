#!/bin/bash
set -euo pipefail
if [[ "${1:-}" == --model-library ]]; then
    cd /opt/studio
    export PYTHONPATH=/root/ComfyUI/custom_nodes
    exec python3 -c 'from studio_worker.model_routes import serve; serve()'
fi
cd /root/ComfyUI
# CLI_ARGS is an operator-owned argument list, never user prompt text.
read -r -a arguments <<< "${CLI_ARGS:-}"
exec python3 main.py --listen 0.0.0.0 --port 8188 "${arguments[@]}" "$@"
