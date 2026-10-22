# Radiance Node

A ComfyUI custom node that runs [Radiance](https://codeberg.org/StillDeadcode/radiance)
image and video generation in ComfyUI's queue. It needs the Radiance runtime at
`/opt/radiance`, which the worker image provides.

## Install

The Studio container image includes it at `/app/comfyui/radiance`, so a ComfyUI
image can copy it from the matching Studio release into `custom_nodes/radiance`.

## Behaviour

One Radiance worker is reused within the container's serial queue, on a single
loopback endpoint. Before ComfyUI runs any other GPU node, the node releases
Radiance's retained weights. LoRA loading in other graphs uses the upstream
ComfyUI and rgthree nodes. ComfyUI caches the last LoRA per loader instance;
rgthree's Power LoRA Loader creates fresh instances and may reread weights.
