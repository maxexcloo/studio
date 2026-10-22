"""Release retained Radiance weights before ComfyUI executes other GPU nodes."""

import inspect
from functools import wraps

from .backend import stop_worker

RETAINING_NODES = {
    "LoadImage",
    "PreviewImage",
    "RadianceImageGenerate",
    "RadianceVideoGenerate",
    "SaveImage",
    "SaveVideo",
}


def install_hooks(execution, model_management):
    if getattr(execution, "_radiance_lifecycle", False):
        return
    execute = execution.execute
    if list(inspect.signature(execute).parameters)[:4] != [
        "server",
        "dynprompt",
        "caches",
        "current_item",
    ]:
        raise RuntimeError(
            "ComfyUI execution changed; review Radiance worker lifecycle integration."
        )

    @wraps(execute)
    async def execute_node(server, dynprompt, caches, current_item, *args, **kwargs):
        # These core nodes only read/write CPU media (SaveVideo stream-copies
        # Radiance MP4s). All other nodes release Radiance first, including
        # custom GPU nodes and mixed upscale graphs.
        if dynprompt.get_node(current_item)["class_type"] not in RETAINING_NODES:
            stop_worker()
        try:
            result = await execute(
                server, dynprompt, caches, current_item, *args, **kwargs
            )
        except BaseException:
            stop_worker()
            raise
        if result[0] == execution.ExecutionResult.FAILURE:
            stop_worker()
        return result

    unload_all_models = model_management.unload_all_models

    @wraps(unload_all_models)
    def unload_models(*args, **kwargs):
        stop_worker()
        return unload_all_models(*args, **kwargs)

    execution.execute = execute_node
    model_management.unload_all_models = unload_models
    execution._radiance_lifecycle = True
