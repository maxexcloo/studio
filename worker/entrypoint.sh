#!/bin/bash
set -euo pipefail
mode=${1:?Choose media or text mode.}
shift
case "$mode" in
    media)
        cd /root/ComfyUI
        # CLI_ARGS is an operator-owned argument list, never user prompt text.
        read -r -a arguments <<< "${CLI_ARGS:-}"
        exec python3 main.py --listen 0.0.0.0 --port 8188 "${arguments[@]}" "$@"
        ;;
    text)
        exec /opt/radiance/runtime/ld-linux-x86-64.so.2 \
            --library-path /opt/radiance/runtime/lib /opt/radiance/bin/radiance "$@"
        ;;
    *) echo "Choose media or text mode." >&2; exit 64 ;;
esac
