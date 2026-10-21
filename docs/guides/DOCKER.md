# Docker

Run Studio in a container while ComfyUI stays where the GPU is. The image
holds the studio alone, talks to a running ComfyUI over the network, and reads
the images ComfyUI writes through a mount of ComfyUI's output folder. Data and
the settings you make in the app live on a volume, not in the image.

What a container does differently from running from source: the server
listens on `0.0.0.0` so the published port reaches it, its data and saved
settings are under `/data` (`STUDIO_DATA_DIR`, `STUDIO_ENV_FILE=/data/.env`), and
it looks for ComfyUI at `http://host.docker.internal:8188` until you save
another address.

CI publishes verified images to `ghcr.io/maxexcloo/studio`: `latest` and
`sha-<full commit>` from `main`, and `X.Y.Z` and `X.Y` from each release. Use
one of those in place of a local build where you deploy.

## Build and start

With compose, from the project directory. Put ComfyUI's output folder in a
`.env` file next to `docker-compose.yml` once (compose reads it for every
command, so `logs`, `restart` and `down` work too):

```bash
echo "COMFY_OUTPUT_HOST=/path/to/ComfyUI/output" >> .env
docker compose up --build
```

The studio answers at http://localhost:8787 on this computer, same as a plain
install. An existing `.env` from a plain install is fine next to it: compose
only reads `COMFY_OUTPUT_HOST` and `STUDIO_DOCKER_COMFY_URL` from it.

Without compose, same result by hand:

```bash
docker build -t studio .
docker run --name studio -d -p 127.0.0.1:8787:8787 \
  --add-host=host.docker.internal:host-gateway \
  -e STUDIO_DOCKER_HOST_ONLY=1 \
  -v studio-data:/data \
  -v /path/to/ComfyUI/output:/comfy-output \
  -e COMFY_OUTPUT_DIR=/comfy-output \
  studio
```

## This computer, and only this computer

Docker hands the container your browser's requests from an address of its
own (the bridge gateway, or 192.168.65.1 on Docker Desktop), never from
127.0.0.1, so the studio would take its own computer for another device and
ask it to sign in. `STUDIO_DOCKER_HOST_ONLY=1` tells it that every connection
comes from this computer. That is only true while the port is published on
`127.0.0.1` alone, as above: published on every address, anyone on your
network would get the studio as if they sat at your computer. Keep the two
together.

Phones and other devices aren't supported in this setup yet.

## Reaching ComfyUI

ComfyUI is looked for at `http://host.docker.internal:8188`, the Docker name
for the computer Docker runs on (compose adds it on plain Linux, Docker Desktop
knows it anyway, `--add-host` does it for `docker run`). ComfyUI has to listen
beyond 127.0.0.1 for the container to reach it: start it with `--listen`.

On another machine or port, change it in **Settings › Workers**; the address
is saved on the data volume and kept. To change the starting point instead,
set `STUDIO_DOCKER_COMFY_URL` in the compose `.env` (or `-e
STUDIO_DEFAULT_COMFY_URL=...` with `docker run`).

## The output folder

Studio reads the images ComfyUI produces straight from the folder ComfyUI
writes to. The path ComfyUI reports is one on the machine it runs on, which the
container only reaches if you mount it, so the output folder is mounted at
`/comfy-output` and `COMFY_OUTPUT_DIR` points there. Without the mount the
studio still runs, but the gallery stays empty.

## Notes

- **Data**: the `studio-data` volume (`heiss-data` in older instructions; keep the one you have) keeps the gallery, downloads and
  saved settings across rebuilds and new containers. To use a folder instead
  (`-v /some/folder:/data`), make it writable for the container's user first:
  `sudo chown 1000:1000 /some/folder`.
- **Updates**: deploy a newer image tag, or pull the source and
  `docker compose up --build`.
- **Video previews**: the image brings `ffmpeg-static`, the same optional
  encoder the app installs otherwise.
- **Node version**: the image uses the Node.js version pinned in the
  `Dockerfile`.
