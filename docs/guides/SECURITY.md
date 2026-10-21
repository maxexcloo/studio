# Security

Studio is built to run on your own machine, for you. By default it answers only this computer: it listens on `127.0.0.1`, and nothing about it is reachable from your network or the internet.

## Who may do what

| Who | Can use the studio | Can look after the computer* | Can change passwords, the admin switch, sign-ins |
| --- | --- | --- | --- |
| This computer (`http://localhost:8787`) | Yes | Yes | Yes |
| A device signed in with the studio password (LAN mode) | Yes | Only with **Trust other devices with admin** on | No |
| A device that hasn't signed in, or LAN mode off | No | No | No |
| Anything reached through a proxy or tunnel on this computer | Like any other device: it signs in | Same as a device | No |
| Another website open in your browser | No | No | No |

\* Node and model installs, the output folder, ComfyUI's address and restarts, clearing the gallery.

- **Other websites.** A page you visit shares your browser with Studio and could send it requests. Every `/api` and `/comfy` request has to name Studio's own address (so a hostname rebound to `127.0.0.1` gets nothing), and anything that changes state has to come from the studio's own page: same origin, and JSON or the studio's `X-Studio` header, which no other site can send without a permission Studio never grants.
- **Other devices** are only answered in LAN mode (**Settings › Workers › Open on other devices**, or `npm start -- --lan`), only from private network addresses, and only after signing in with the studio password. A sign-in lasts a week (`STUDIO_DEVICE_SESSION_DAYS`); **Sign out all devices** ends every one of them. Wrong passwords lock the device's address out for longer each time, one try at a time; the computer itself is never slowed down by them.
- **Proxies.** A request that carries `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, `Via` or a similar header is never treated as this computer, even though the proxy connects from it. Only use Studio behind a proxy or tunnel with LAN mode on and a studio password set, and list the name it is reached by in `STUDIO_ALLOWED_HOSTS`.
- **The network itself.** Plain http on your network is unencrypted: someone on the same Wi-Fi can read the studio password and a sign-in cookie. Use it only on a network you trust, or add a certificate under **Settings › Workers › HTTPS** (for example from `tailscale cert`); then other devices use HTTPS, cookies are marked `Secure`, and plain http answers only this computer. Never expose Studio to the public internet.

## What Studio protects

- **Deleting.** **Delete all finished images** moves files to `.heiss-trash` in ComfyUI's output folder for 30 days (`STUDIO_TRASH_DAYS`), so it can be undone. The output folder has to be one ComfyUI writes to, and Studio only ever serves images, videos and sound from it (never through a link out of it).
- **Updates.** Studio doesn't update itself. New versions arrive as container images that CI builds, tests and scans before publishing.
- **Node packs** installed with one click come from a reviewed commit of each pack, and their Python requirements can't replace the PyTorch or NumPy ComfyUI runs on. When ComfyUI-Manager refuses an install because of its security level, Studio stops and asks.
- **Model downloads** only come from Studio's own catalog on Hugging Face, resume only while the remote file is unchanged, and are checked against their published SHA-256.
- **Workflows** you import can contain custom nodes that run code, read or write any file, or go online; the import review names them. A workflow runs every node in it with ComfyUI's access to your computer, so only import workflows from people you trust.
- **No telemetry.** Studio talks to your ComfyUI, to Hugging Face or GitHub when you ask it to download or install something and to the Civitai or LiteLLM services an administrator configures. Nothing else.

## Reporting a vulnerability

Please report security issues privately through a [GitHub security advisory](https://github.com/maxexcloo/studio/security/advisories/new) rather than a public issue.

## Other devices: signing in, admin, HTTPS and proxies

- **Signing in.** Phones and other computers sign in once with the studio password and stay signed in for a week. Each wrong password locks that device out a little longer, and this computer isn't slowed down by them. **Settings › Workers** lists the signed-in devices, and **Sign out all devices** ends every session.
- **Admin stays at the computer.** Node packs and model downloads, the ComfyUI address, the output folder, the Hugging Face token, importing and deleting workflows, restarts and clearing the gallery are for the computer running Studio, and other devices don't show those controls. Turn on **Trust other devices with admin** (at the computer) to allow them from signed-in devices too. The passwords, that switch, HTTPS and signing devices out only change at the computer.
- **HTTPS.** Over plain http, what devices send (the studio password too) crosses the network unencrypted, and the phone's share sheet isn't available (Share saves the file instead). Under **Settings › Workers › Advanced › HTTPS for other devices**, add a certificate that browsers already trust, for example the two files `tailscale cert <machine>.<tailnet>.ts.net` writes (or set `STUDIO_TLS_CERT` and `STUDIO_TLS_KEY` in `.env`). After a restart, other devices open `https://<that name>:8788` (`STUDIO_HTTPS_PORT`), and this computer keeps `http://localhost:8787`. There's no self-signed option, since a warning people learn to click through doesn't protect anything.
- **Behind your own proxy or tunnel** (Caddy, nginx, `tailscale serve`, cloudflared), every visitor counts as another device and signs in like a phone, even though the proxy connects from this computer. Add the name they use to `STUDIO_ALLOWED_HOSTS`; requests for any other name are turned away.
