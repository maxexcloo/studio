# Security

Deployments run Studio in account mode (`STUDIO_MULTI_USER=1`, see [Configuration › Multi-User Mode](CONFIGURATION.md#multi-user-mode)): every request needs an account, including requests from the computer running it. Without that setting (the default) Studio is a single-user studio that answers only this computer, described at the end under [Single-user mode](#single-user-mode).

## Who may do what

| Who                                      | Can use the studio                                                                 | Can look after the studio* | Can manage accounts and groups                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- |
| An administrator account                 | Yes                                                                                | Yes                        | Yes                                                   |
| An ordinary account                      | What its group allows, on its own outputs                                          | No                         | No (only its own name, email, password and MCP token) |
| A personal MCP token                     | Generate, read its own jobs and results, upload references, compare its own images | No                         | No                                                    |
| No account, or a waiting or disabled one | No                                                                                 | No                         | No                                                    |
| Another website open in your browser     | No                                                                                 | No                         | No                                                    |

\* Models, downloads and node packs, workers and ComfyUI's address and restarts, the output folder, workflow files, presets, logs and raw ComfyUI access.

- **Signing in.** Accounts sign in with their email address and password (stored only as a scrypt hash) or through single sign-on (`STUDIO_OIDC_*`). Wrong passwords are limited per address and email, one try at a time: after five, each one locks that pair out twice as long as the last (up to 15 minutes), answered with `429` and `Retry-After`. A sign-in lasts 30 days, in an `HttpOnly`, `SameSite=Strict` cookie. Changing your password in **Settings › Account** ends your other sessions; disabling an account ends all of its sessions.
- **The first administrator** is created on the first visit from the computer running Studio. On a container platform, where nobody opens it there, set `STUDIO_SETUP_TOKEN` (at least 32 characters): the setup screen accepts it from any address until the first account exists. Remove it afterwards.
- **Ordinary accounts** only reach routes that were reviewed and check the owner; any new route stays administrator-only until it is added. Their outputs, prompt history, LoRA stacks, references and jobs are private to them.
- **Personal MCP tokens** are shown once, stored only as hashes, and work only for MCP. They never act as an administrator, even when an administrator issued them.
- **Probes.** `/api/ping` and `/api/ready` answer without an account and reveal nothing private.
- **Other websites.** A page you visit shares your browser with Studio and could send it requests. Every `/api` and `/comfy` request has to name Studio's own address (so a hostname rebound to it gets nothing), and anything that changes state has to come from the studio's own page: same origin, and JSON or the studio's `X-Studio` header, which no other site can send without a permission Studio never grants.
- **Proxies and HTTPS.** Run Studio behind a TLS-terminating proxy and list the name it is reached by in `STUDIO_ALLOWED_HOSTS`; requests naming any host other than that, localhost and the machine's own addresses are turned away. Cookies are marked `Secure` when the request arrived over HTTPS, directly or through a proxy that sends `X-Forwarded-Proto: https`. Plain http sends passwords and cookies unencrypted, so never offer it beyond a network you trust.

## What Studio protects

- **Deleting.** Deleting a card deletes its file. Studio only deletes inside its own media folder or ComfyUI's output folder, never a file shown from somewhere else, and only ever serves images, videos and sound from those folders (never through a link out of them). A `.studio-trash` folder left by an older version's **Delete all finished images** is emptied after 30 days (`STUDIO_TRASH_DAYS`).
- **Updates.** Studio doesn't update itself. New versions arrive as container images that CI builds and tests before publishing.
- **Node packs** installed with one click come from a reviewed commit of each pack, and their Python requirements can't replace the PyTorch or NumPy ComfyUI runs on. When ComfyUI-Manager refuses an install because of its security level, Studio stops and asks.
- **Model downloads** only come from Studio's own catalogue and reviewed Civitai and Hugging Face imports, resume only while the remote file is unchanged, and are checked against their published SHA-256. Provider tokens (`HF_TOKEN`, `CIVITAI_API_TOKEN`) come from the deployment's environment; Studio never shows, saves or changes them.
- **Workflows** you import can contain custom nodes that run code, read or write any file, or go online; the import review names them. A workflow runs every node in it with ComfyUI's access to its computer, so only import workflows from people you trust.
- **No telemetry.** Studio talks to your ComfyUI, to Hugging Face or GitHub when you ask it to download or install something, and to the catalogue, text and cloud provider endpoints an administrator configures.

## Reporting a vulnerability

Please report security issues privately through a [GitHub security advisory](https://github.com/maxexcloo/studio/security/advisories/new) rather than a public issue.

## Single-user mode

Only without accounts (`STUDIO_MULTI_USER` unset), for development on your own computer. It answers only the computer running Studio, which also looks after it; there is no sign-in. A request from any other address, or one that carries `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, `Via` or a similar proxy header, is refused, even when the proxy runs on the same computer. In Docker, publish the port on the host's `127.0.0.1` only and set `STUDIO_DOCKER_HOST_ONLY=1` ([Docker](DOCKER.md)). Use account mode for any other device.
