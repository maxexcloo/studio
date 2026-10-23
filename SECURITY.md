# Security

Deployments run Studio in account mode (`STUDIO_MULTI_USER=1`, see [Configuration › Multi-User Mode](CONFIGURATION.md#multi-user-mode)): every request needs an account, including requests from the computer running it. Without that setting (the default) Studio is a single-user studio that answers only this computer, described at the end under [Single-user mode](#single-user-mode-lan-and-the-studio-password).

## Who may do what

| Who                                      | Can use the studio                                         | Can look after the studio* | Can manage accounts and groups                        |
| ---------------------------------------- | ---------------------------------------------------------- | -------------------------- | ----------------------------------------------------- |
| An administrator account                 | Yes                                                        | Yes                        | Yes                                                   |
| An ordinary account                      | What its group allows, on its own outputs                  | No                         | No (only its own name, email, password and MCP token) |
| A personal MCP token                     | Generate, read its own jobs and results, upload references | No                         | No                                                    |
| No account, or a waiting or disabled one | No                                                         | No                         | No                                                    |
| Another website open in your browser     | No                                                         | No                         | No                                                    |

\* Models, downloads and node packs, workers and ComfyUI's address and restarts, the output folder, workflow files, presets, logs and raw ComfyUI access.

- **Signing in.** Accounts sign in with their email address and password (stored only as a scrypt hash) or through single sign-on (`STUDIO_OIDC_*`). Wrong passwords are limited per address and email, one try at a time: after five, each one locks that pair out twice as long as the last (up to 15 minutes), answered with `429` and `Retry-After`. A sign-in lasts 30 days, in an `HttpOnly`, `SameSite=Strict` cookie. Changing your password in **Settings › Account** ends your other sessions; disabling an account ends all of its sessions.
- **The first administrator** is created on the first visit from the computer running Studio. On a container platform, where nobody opens it there, set `STUDIO_SETUP_TOKEN` (at least 32 characters): the setup screen accepts it from any address until the first account exists. Remove it afterwards.
- **Ordinary accounts** only reach routes that were reviewed and check the owner; any new route stays administrator-only until it is added. Their outputs, prompt history, LoRA stacks, references and jobs are private to them.
- **Personal MCP tokens** are shown once, stored only as hashes, and work only for MCP. They never act as an administrator, even when an administrator issued them.
- **Probes.** `/api/ping` and `/api/ready` answer without an account and reveal nothing private.
- **Other websites.** A page you visit shares your browser with Studio and could send it requests. Every `/api` and `/comfy` request has to name Studio's own address (so a hostname rebound to it gets nothing), and anything that changes state has to come from the studio's own page: same origin, and JSON or the studio's `X-Studio` header, which no other site can send without a permission Studio never grants.
- **Proxies and HTTPS.** Run Studio behind a TLS-terminating proxy and list the name it is reached by in `STUDIO_ALLOWED_HOSTS`; requests naming any host other than that, localhost and the machine's own addresses are turned away. Cookies are marked `Secure` when the request arrived over HTTPS, directly or through a proxy that sends `X-Forwarded-Proto: https`. Plain http sends passwords and cookies unencrypted, so never offer it beyond a network you trust.

## What Studio protects

- **Deleting.** Deleting a card deletes its file. Studio only deletes inside its own media folder or ComfyUI's output folder, never a file shown from somewhere else, and only ever serves images, videos and sound from those folders (never through a link out of them). A `.heiss-trash` folder left by an older version's **Delete all finished images** is emptied after 30 days (`STUDIO_TRASH_DAYS`).
- **Updates.** Studio doesn't update itself. New versions arrive as container images that CI builds, tests and scans before publishing.
- **Node packs** installed with one click come from a reviewed commit of each pack, and their Python requirements can't replace the PyTorch or NumPy ComfyUI runs on. When ComfyUI-Manager refuses an install because of its security level, Studio stops and asks.
- **Model downloads** only come from Studio's own catalogue and reviewed Civitai and Hugging Face imports, resume only while the remote file is unchanged, and are checked against their published SHA-256. Provider tokens (`HF_TOKEN`, `CIVITAI_API_TOKEN`) come from the deployment's environment; Studio never shows, saves or changes them.
- **Workflows** you import can contain custom nodes that run code, read or write any file, or go online; the import review names them. A workflow runs every node in it with ComfyUI's access to its computer, so only import workflows from people you trust.
- **No telemetry.** Studio talks to your ComfyUI, to Hugging Face or GitHub when you ask it to download or install something and to the Civitai or LiteLLM services an administrator configures. Nothing else.

## Reporting a vulnerability

Please report security issues privately through a [GitHub security advisory](https://github.com/maxexcloo/studio/security/advisories/new) rather than a public issue.

## Single-user mode: LAN and the studio password

Only without accounts (`STUDIO_MULTI_USER` unset). This mode is kept for a studio on your own computer and may be retired.

By default a single-user studio answers only this computer: it listens on `127.0.0.1`, and nothing about it is reachable from your network.

| Who                                                         | Can use the studio                 | Can look after the computer*                    | Can change the studio password, the admin switch, sign-ins |
| ----------------------------------------------------------- | ---------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| This computer (`http://localhost:8787`)                     | Yes                                | Yes                                             | Yes                                                        |
| A device signed in with the studio password (LAN mode)      | Yes                                | Only with **Trust other devices with admin** on | No                                                         |
| A device that hasn't signed in, or LAN mode off             | No                                 | No                                              | No                                                         |
| Anything reached through a proxy or tunnel on this computer | Like any other device: it signs in | Same as a device                                | No                                                         |

- **Other devices** are only answered in LAN mode (**Settings › Workers › Open on other devices**, or `npm start -- --lan`), only from private network addresses, and only after signing in with the studio password, set on this computer. A sign-in lasts a week (`STUDIO_DEVICE_SESSION_DAYS`); **Sign out all devices** ends every one of them. Wrong passwords lock the device's address out for longer each time, one try at a time; the computer itself is never slowed down by them.
- **Admin stays at the computer.** Looking after the computer is for the computer running Studio, and other devices don't show those controls. Turn on **Trust other devices with admin** (at the computer) to allow them from signed-in devices too. The studio password, that switch, HTTPS and signing devices out only change at the computer.
- **Proxies.** A request that carries `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, `Via` or a similar header is never treated as this computer, even though the proxy connects from it, and signs in like a phone. Only use a single-user studio behind a proxy or tunnel with LAN mode on and a studio password set, and list the name it is reached by in `STUDIO_ALLOWED_HOSTS`.
- **HTTPS.** Over plain http, what devices send (the studio password too) crosses the network unencrypted. Under **Settings › Workers › Advanced › HTTPS for other devices**, add a certificate that browsers already trust, for example the two files `tailscale cert <machine>.<tailnet>.ts.net` writes (or set `STUDIO_TLS_CERT` and `STUDIO_TLS_KEY`). After a restart, other devices open `https://<that name>:8788` (`STUDIO_HTTPS_PORT`), cookies are marked `Secure`, and this computer keeps `http://localhost:8787`. There's no self-signed option, since a warning people learn to click through doesn't protect anything.
