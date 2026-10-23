"""Exercise the registered handlers without installing ComfyUI or aiohttp."""

import asyncio
import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class Routes:
    def __init__(self):
        self.handlers = {}

    def route(self, method):
        def decorator(path):
            def register(handler):
                self.handlers[(method, path)] = handler
                return handler

            return register

        return decorator

    get = property(lambda self: self.route("GET"))
    post = property(lambda self: self.route("POST"))
    put = property(lambda self: self.route("PUT"))


class Request:
    def __init__(self, token=None):
        self.headers = {} if token is None else {"X-Studio-Worker-Token": token}
        self.query = {}

    async def json(self):
        return {"folder": "loras", "file": "model.safetensors"}


class ModelRouteTests(unittest.TestCase):
    def handlers(self, root, token):
        routes = Routes()
        folder_paths = types.SimpleNamespace(
            models_dir=str(root), get_folder_paths=lambda folder: [str(root / folder)]
        )
        web = types.SimpleNamespace(
            json_response=lambda body, status=200: (status, body)
        )
        fake_modules = {
            "folder_paths": folder_paths,
            "aiohttp": types.SimpleNamespace(web=web),
            "server": types.SimpleNamespace(
                PromptServer=types.SimpleNamespace(
                    instance=types.SimpleNamespace(routes=routes)
                )
            ),
        }
        name = "studio_worker_route_fixture"
        spec = importlib.util.spec_from_file_location(
            name,
            Path(__file__).parent / "__init__.py",
            submodule_search_locations=[str(Path(__file__).parent)],
        )
        module = importlib.util.module_from_spec(spec)
        with (
            patch.dict(sys.modules, {**fake_modules, name: module}),
            patch.dict(os.environ, {"STUDIO_WORKER_TOKEN": token}),
        ):
            spec.loader.exec_module(module)
        return routes.handlers

    def test_model_handlers_reject_blank_missing_and_wrong_tokens(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for configured in ["", "configured-test-fixture"]:
                handlers = self.handlers(root, configured)
                for route in [
                    ("GET", "/studio/worker/models"),
                    ("POST", "/studio/worker/models/file"),
                    ("PUT", "/studio/worker/models/upload"),
                ]:
                    for supplied in [None, "", "wrong-test-fixture"]:
                        status, _ = asyncio.run(handlers[route](Request(supplied)))
                        self.assertEqual(status, 403, (configured, route, supplied))

    def test_authenticated_handlers_read_only_the_configured_library(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "loras").mkdir()
            (root / "loras/model.safetensors").write_bytes(b"weights")
            handlers = self.handlers(root, "configured-test-fixture")
            request = Request("configured-test-fixture")
            status, inventory = asyncio.run(
                handlers[("GET", "/studio/worker/models")](request)
            )
            self.assertEqual(status, 200)
            self.assertEqual(inventory["files"][0]["path"], "loras/model.safetensors")
            status, metadata = asyncio.run(
                handlers[("POST", "/studio/worker/models/file")](request)
            )
            self.assertEqual(status, 200)
            self.assertEqual(metadata["size"], 7)
