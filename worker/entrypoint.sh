#!/bin/bash
set -euo pipefail
cd /root/ComfyUI
# CLI_ARGS is an operator-owned argument list, never user prompt text.
read -r -a arguments <<< "${CLI_ARGS:-}"
exec python3 main.py --listen 0.0.0.0 --port 8188 "${arguments[@]}" "$@"
