import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from radiance.lifecycle import install_hooks


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_cpu_image_nodes_retain_worker_and_gpu_nodes_release_before_execution(
        self,
    ):
        events = []

        async def execute(server, dynprompt, caches, current_item, *args, **kwargs):
            events.append("execute")
            return ("success", None, None)

        execution = SimpleNamespace(
            execute=execute, ExecutionResult=SimpleNamespace(FAILURE="failure")
        )
        management = SimpleNamespace(unload_all_models=Mock())
        with patch(
            "radiance.lifecycle.stop_worker",
            side_effect=lambda: events.append("stop"),
        ):
            install_hooks(execution, management)
            for node in [
                "RadianceImageGenerate",
                "RadianceVideoGenerate",
                "LoadImage",
                "SaveImage",
                "SaveVideo",
                "PreviewImage",
                "KSampler",
                "CreateVideo",
                "CustomUpscaler",
            ]:
                events.clear()
                prompt = Mock()
                prompt.get_node.return_value = {"class_type": node}
                self.assertEqual(
                    await execution.execute(None, prompt, None, "1"),
                    ("success", None, None),
                )
                self.assertEqual(
                    events,
                    ["execute"]
                    if node
                    in {
                        "RadianceImageGenerate",
                        "RadianceVideoGenerate",
                        "LoadImage",
                        "SaveImage",
                        "SaveVideo",
                        "PreviewImage",
                    }
                    else ["stop", "execute"],
                )
            wrapped = execution.execute
            install_hooks(execution, management)
            self.assertIs(execution.execute, wrapped)
            events.clear()
            management.unload_all_models()
            self.assertEqual(events, ["stop"])

    async def test_failure_after_radiance_releases_worker(self):
        async def execute(server, dynprompt, caches, current_item):
            return ("failure", {}, None)

        execution = SimpleNamespace(
            execute=execute, ExecutionResult=SimpleNamespace(FAILURE="failure")
        )
        prompt = Mock()
        prompt.get_node.return_value = {"class_type": "SaveImage"}
        with patch("radiance.lifecycle.stop_worker") as stop:
            install_hooks(execution, SimpleNamespace(unload_all_models=Mock()))
            await execution.execute(None, prompt, None, "1")
        stop.assert_called_once()

    async def test_changed_execution_signature_fails_before_installing(self):
        execution = SimpleNamespace(execute=AsyncMock())
        with self.assertRaisesRegex(RuntimeError, "execution changed"):
            install_hooks(execution, SimpleNamespace(unload_all_models=Mock()))
