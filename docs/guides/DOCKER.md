# Docker

Run HEISS UI in a container while ComfyUI stays where the GPU is. The image
holds the studio alone, talks to a running ComfyUI over the network, and reads
the images ComfyUI writes through a mount of ComfyUI's output folder. Data and
the settings you make in the app live on a volume, not in the image.

What a container does differently from a plain install: the server listens on
`0.0.0.0` so the published port reaches it, it doesn't open a browser
(`HEISS_NO_BROWSER=1`), its data and saved settings are under `/data`
(`HEISS_DATA_DIR`, `HEISS_ENV_FILE=/data/.env`), and it looks for ComfyUI at
`http://host.docker.internal:8188` until you save another address. The image
ships without `.git`, so the in-app updater can't update it: for a new release,
pull the source and rebuild.

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
only reads `COMFY_OUTPUT_HOST` and `HEISS_DOCKER_COMFY_URL` from it.

Without compose, same result by hand:

```bash
docker build -t heiss .
docker run --name heiss-ui -d -p 127.0.0.1:8787:8787 \
  --add-host=host.docker.internal:host-gateway \
  -e HEISS_DOCKER_HOST_ONLY=1 \
  -v heiss-data:/data \
  -v /path/to/ComfyUI/output:/comfy-output \
  -e COMFY_OUTPUT_DIR=/comfy-output \
  heiss
```

## This computer, and only this computer

Docker hands the container your browser's requests from an address of its
own (the bridge gateway, or 192.168.65.1 on Docker Desktop), never from
127.0.0.1, so the studio would take its own computer for another device and
ask it to sign in. `HEISS_DOCKER_HOST_ONLY=1` tells it that every connection
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

On another machine or port, change it in **Settings › Connection**; the address
is saved on the data volume and kept. To change the starting point instead,
set `HEISS_DOCKER_COMFY_URL` in the compose `.env` (or `-e
HEISS_DEFAULT_COMFY_URL=...` with `docker run`).

## The output folder

HEISS reads the images ComfyUI produces straight from the folder ComfyUI
writes to. The path ComfyUI reports is one on the machine it runs on, which the
container only reaches if you mount it, so the output folder is mounted at
`/comfy-output` and `COMFY_OUTPUT_DIR` points there. Without the mount the
studio still runs, but the gallery stays empty.

## Notes

- **Data**: the `heiss-data` volume keeps the gallery, the vault, downloads and
  saved settings across rebuilds and new containers. To use a folder instead
  (`-v /some/folder:/data`), make it writable for the container's user first:
  `sudo chown 1000:1000 /some/folder`.
- **Updates**: Settings › About reports that this copy isn't a Git checkout.
  New version: pull the source and `docker compose up --build`.
- **Video previews**: the image brings `ffmpeg-static`, the same optional
  encoder the app installs otherwise.
- **Node version**: the image uses Node 22, the version the launcher
  recommends.
