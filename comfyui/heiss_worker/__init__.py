"""HEISS worker endpoints: let a HEISS studio remove the outputs and staged inputs it has collected.

HEISS fetches each finished output over ComfyUI's /view API into its own storage, then asks
this node to delete ComfyUI's copy, so ComfyUI keeps no studio data. Set HEISS_WORKER_TOKEN
in both ComfyUI and HEISS to require it on these endpoints.
"""
import os

from .files import delete_files, token_matches

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
VERSION = 1

try:
    import folder_paths
    from aiohttp import web
    from server import PromptServer
except ImportError:  # Imported outside ComfyUI (tests).
    PromptServer = None

if PromptServer is not None and getattr(PromptServer, 'instance', None) is not None:
    routes = PromptServer.instance.routes
    token = os.environ.get('HEISS_WORKER_TOKEN', '')

    def bases():
        return {
            'output': folder_paths.get_output_directory(),
            'input': folder_paths.get_input_directory(),
            'temp': folder_paths.get_temp_directory(),
        }

    @routes.get('/heiss/worker')
    async def heiss_worker_status(request):
        return web.json_response({'ok': True, 'version': VERSION, 'tokenRequired': bool(token)})

    @routes.post('/heiss/worker/delete')
    async def heiss_worker_delete(request):
        if not token_matches(token, request.headers.get('X-Heiss-Worker-Token')):
            return web.json_response({'ok': False, 'error': 'A valid HEISS worker token is required.'}, status=403)
        try:
            body = await request.json()
            return web.json_response({'ok': True, **delete_files(bases(), body.get('files'))})
        except (ValueError, AttributeError) as error:
            return web.json_response({'ok': False, 'error': str(error) or 'Invalid request.'}, status=400)
