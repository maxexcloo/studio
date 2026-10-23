"""Studio worker endpoints: let Studio remove the outputs and staged inputs it has collected.

Studio fetches each finished output over ComfyUI's /view API into its own storage, then asks
this node to delete ComfyUI's copy, so ComfyUI keeps no studio data. Set STUDIO_WORKER_TOKEN
in both ComfyUI and Studio to require it on these endpoints.
"""

import asyncio
import json
import os

from . import models
from .files import delete_files, token_matches

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
VERSION = 2

try:
    import folder_paths
    from aiohttp import web
    from server import PromptServer
except ImportError:  # Imported outside ComfyUI (tests).
    PromptServer = None

if PromptServer is not None and getattr(PromptServer, "instance", None) is not None:
    routes = PromptServer.instance.routes
    token = os.environ.get("STUDIO_WORKER_TOKEN", "")

    def bases():
        return {
            "output": folder_paths.get_output_directory(),
            "input": folder_paths.get_input_directory(),
            "temp": folder_paths.get_temp_directory(),
        }

    @routes.get("/studio/worker")
    async def studio_worker_status(request):
        return web.json_response(
            {"ok": True, "version": VERSION, "tokenRequired": bool(token)}
        )

    @routes.post("/studio/worker/delete")
    async def studio_worker_delete(request):
        if not token_matches(token, request.headers.get("X-Studio-Worker-Token")):
            return web.json_response(
                {"ok": False, "error": "A valid Studio worker token is required."},
                status=403,
            )
        try:
            body = await request.json()
            return web.json_response(
                {"ok": True, **delete_files(bases(), body.get("files"))}
            )
        except (ValueError, AttributeError) as error:
            return web.json_response(
                {"ok": False, "error": str(error) or "Invalid request."}, status=400
            )

    def model_authorised(request):
        # Model mutations require authentication even on an otherwise open ComfyUI worker.
        return bool(token) and token_matches(
            token, request.headers.get("X-Studio-Worker-Token")
        )

    def model_roots():
        roots = {}

        def configured(folder):
            try:
                return folder_paths.get_folder_paths(folder)
            except KeyError:
                return []

        for folder in models.FOLDERS:
            paths = configured(folder)
            if not paths and folder == "text_encoders":
                paths = configured("clip")
            roots[folder] = paths or [os.path.join(folder_paths.models_dir, folder)]
        return roots

    @routes.get("/studio/worker/models")
    async def studio_model_inventory(request):
        if not model_authorised(request):
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
        if not model_authorised(request):
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
            elif action == "replace":
                await asyncio.to_thread(
                    models.preserve_replaced, *args, str(body.get("sha256", ""))
                )
                result = {}
            elif action == "remove":
                result = {
                    "removed": await asyncio.to_thread(
                        models.remove, *args, str(body.get("sha256", ""))
                    )
                }
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
        if not model_authorised(request):
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
