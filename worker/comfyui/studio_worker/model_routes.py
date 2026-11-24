"""Authenticated file operations shared by ComfyUI and the storage-only worker."""

import asyncio
import json
import os
from pathlib import Path

from . import convert, models
from .files import token_matches


def model_authorised(token, request):
    return bool(token) and token_matches(
        token, request.headers.get("X-Studio-Worker-Token")
    )


def register_model_routes(routes, web, token, model_roots):
    @routes.get("/studio/worker/models")
    async def studio_model_inventory(request):
        if not model_authorised(token, request):
            return web.json_response(
                {"ok": False, "error": "A valid Studio worker token is required."},
                status=403,
            )
        try:
            result = await asyncio.to_thread(models.inventory, model_roots())
            return web.json_response({"ok": True, **result})
        except (ValueError, OSError):
            return web.json_response(
                {"ok": False, "error": "The worker model library is unavailable."},
                status=400,
            )

    @routes.post("/studio/worker/models/file")
    async def studio_model_file(request):
        if not model_authorised(token, request):
            return web.json_response(
                {"ok": False, "error": "A valid Studio worker token is required."},
                status=403,
            )
        try:
            body = await request.json()
            args = (model_roots(), body.get("folder"), body.get("file"))
            action = body.get("action", "stat")
            if action == "discard":
                await models.discard_when_idle(*args)
                result = {}
            elif action == "remove":
                result = {
                    "removed": await asyncio.to_thread(
                        models.remove, *args, str(body.get("sha256", ""))
                    )
                }
            elif action == "cancel":
                models.cancel_fetch(*args)
                result = {}
            elif action == "fetch":
                result = await asyncio.to_thread(
                    models.start_fetch,
                    *args,
                    str(body.get("repo", "")),
                    str(body.get("revision", "")),
                    str(body.get("path", "")),
                    int(body.get("size", 0)),
                    str(body.get("sha256", "")),
                    body.get("note") if isinstance(body.get("note"), dict) else {},
                    str(body.get("token", "")),
                )
            elif action in {"stat", "hash"}:
                result = await asyncio.to_thread(models.state, *args, action == "hash")
            else:
                raise ValueError("Unknown model operation.")
            return web.json_response({"ok": True, **result})
        except (ValueError, TypeError, AttributeError):
            return web.json_response(
                {"ok": False, "error": "Invalid or conflicting model operation."},
                status=400,
            )
        except OSError:
            return web.json_response(
                {"ok": False, "error": "The worker model operation failed."}, status=400
            )

    @routes.put("/studio/worker/models/upload")
    async def studio_model_upload(request):
        if not model_authorised(token, request):
            return web.json_response(
                {"ok": False, "error": "A valid Studio worker token is required."},
                status=403,
            )
        try:
            q = request.query
            note = json.loads(request.headers.get("X-Studio-Model-Metadata", "{}"))
            if not isinstance(note, dict):
                raise TypeError("Invalid transfer metadata.")
            result = await models.receive(
                model_roots(),
                q.get("folder"),
                q.get("file"),
                int(q.get("offset", "0")),
                int(q.get("size", "0")),
                q.get("sha256", ""),
                note,
                request.content.iter_chunked(256 * 1024),
            )
            return web.json_response({"ok": True, **result})
        except (ValueError, TypeError, AttributeError) as error:
            return web.json_response(
                {"ok": False, "error": str(error) or "Invalid model transfer."},
                status=400,
            )
        except OSError:
            return web.json_response(
                {
                    "ok": False,
                    "error": "The worker could not write the model transfer.",
                },
                status=400,
            )

    @routes.post("/studio/worker/models/radiance")
    async def studio_radiance_conversion(request):
        if not model_authorised(token, request):
            return web.json_response(
                {"ok": False, "error": "A valid Studio worker token is required."},
                status=403,
            )
        try:
            body = await request.json()
            action = body.get("action", "status")
            if action == "start":
                tokens = (
                    body.get("tokens") if isinstance(body.get("tokens"), dict) else {}
                )
                result = convert.start(
                    body.get("name"),
                    body.get("url"),
                    body.get("size"),
                    body.get("sha256"),
                    {kind: str(tokens.get(kind) or "") for kind in ["civitai", "hf"]},
                    body.get("note") if isinstance(body.get("note"), dict) else {},
                )
            elif action == "cancel":
                result = convert.cancel()
            elif action == "clear":
                result = convert.clear(body.get("name"))
            elif action == "status":
                result = convert.status()
            else:
                raise ValueError("Unknown conversion operation.")
            return web.json_response({"ok": True, **result})
        except (ValueError, TypeError, AttributeError, OSError) as error:
            return web.json_response(
                {"ok": False, "error": str(error) or "Invalid conversion request."},
                status=400,
            )


def serve():
    from aiohttp import web

    root = Path(os.environ["STUDIO_MODEL_LIBRARY_DIR"])
    token = os.environ["STUDIO_WORKER_TOKEN"]
    if not token or not root.is_dir():
        raise ValueError(
            "The storage worker needs its model library directory and worker token."
        )

    roots = {folder: [root / folder] for folder in models.FOLDERS}
    # ComfyUI searches both names for these folders.
    roots["diffusion_models"].append(root / "unet")
    roots["text_encoders"].append(root / "clip")
    roots["ultralytics_bbox"] = [root / "ultralytics" / "bbox"]
    routes = web.RouteTableDef()
    register_model_routes(routes, web, token, lambda: roots)

    @routes.get("/studio/worker")
    async def ready(_request):
        return web.json_response({"ok": True})

    app = web.Application()
    app.add_routes(routes)
    web.run_app(app, host="0.0.0.0", port=8188, access_log=None)
