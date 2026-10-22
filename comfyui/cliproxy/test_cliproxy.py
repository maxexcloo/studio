"""Provider contracts without submitting a generation or loading ComfyUI."""

import base64
import importlib.util
import io
import json
import os
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image

NODE = Path(__file__).with_name("__init__.py")
sys.modules.setdefault("folder_paths", types.SimpleNamespace())
spec = importlib.util.spec_from_file_location("cliproxy_node", NODE)
node = importlib.util.module_from_spec(spec)
spec.loader.exec_module(node)

MODELS = {
    "image": (
        "grok-imagine-image",
        "grok-imagine-image-2.0",
        "grok-imagine-image-quality",
    ),
    "video": ("grok-imagine-video", "grok-imagine-video-1.5"),
}
discover_models = node.available_models


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(
            os.environ,
            {"CLIPROXYAPI_KEY": "test-key", "CLIPROXYAPI_URL": "http://proxy.example"},
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        defaults = patch.dict(
            os.environ,
            CLIPROXYAPI_IMAGE_MODEL="grok-imagine-image-quality",
            CLIPROXYAPI_VIDEO_MODEL="grok-imagine-video-1.5",
        )
        defaults.start()
        self.addCleanup(defaults.stop)
        models = patch.object(node, "available_models", return_value=MODELS)
        models.start()
        self.addCleanup(models.stop)
        cancellation = patch.object(node, "check_cancelled")
        cancellation.start()
        self.addCleanup(cancellation.stop)
        cache = patch.object(node, "_model_cache", None)
        cache.start()
        self.addCleanup(cache.stop)

    def test_image_and_edit_contracts(self):
        proxy = node.Proxy()
        with patch.object(
            proxy,
            "call",
            return_value={"data": [{"b64_json": base64.b64encode(b"image").decode()}]},
        ) as call:
            self.assertEqual(proxy.image("draw", "1024x1024"), b"image")
            self.assertEqual(call.call_args.args[0], "/v1/images/generations")
            self.assertEqual(
                call.call_args.args[1]["model"], "grok-imagine-image-quality"
            )
            self.assertEqual(proxy.image("edit", "1024x1024", b"reference"), b"image")
            self.assertEqual(call.call_args.args[0], "/v1/images/edits")
            self.assertIn(b'filename="reference.png"', call.call_args.args[1])
            self.assertIn(b"reference", call.call_args.args[1])

    def test_image_count_returns_every_requested_output(self):
        content = io.BytesIO()
        Image.new("RGB", (16, 16)).save(content, format="PNG")
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(
                node.folder_paths,
                "get_output_directory",
                return_value=directory,
                create=True,
            ),
            patch.object(
                node.Proxy, "image", return_value=content.getvalue()
            ) as generate,
        ):
            result = node.GrokMedia().generate(
                "image", "A tree", 1024, 1024, 6, 1, count=4
            )
            self.assertEqual(generate.call_count, 4)
            outputs = result["ui"]["images"]
            self.assertEqual(len({item["filename"] for item in outputs}), 4)
            self.assertTrue(
                all(
                    (Path(directory) / item["subfolder"] / item["filename"]).is_file()
                    for item in outputs
                )
            )

    def test_image_count_rejects_invalid_values_before_calling_provider(self):
        with patch.object(node.Proxy, "image") as generate:
            for count in [0, 9, 1.5, True]:
                with self.subTest(count=count), self.assertRaises(ValueError):
                    node.GrokMedia().generate(
                        "image", "A tree", 1024, 1024, 6, 1, count=count
                    )
            generate.assert_not_called()

    def test_video_polling_and_reference(self):
        proxy = node.Proxy()
        with (
            patch.object(
                proxy,
                "call",
                side_effect=[
                    {"request_id": "job/id"},
                    {"status": "pending"},
                    {
                        "status": "done",
                        "video": {"url": "https://media.example/video.mp4"},
                    },
                ],
            ) as call,
            patch.object(node.time, "sleep"),
            patch.object(node, "download", return_value=b"video"),
        ):
            self.assertEqual(proxy.video("move", 1280, 720, 6, b"reference"), b"video")
            body = call.call_args_list[0].args[1]
            self.assertEqual(body["aspect_ratio"], "16:9")
            self.assertEqual(body["duration"], 6)
            self.assertEqual(body["model"], "grok-imagine-video-1.5")
            self.assertTrue(body["image"]["url"].startswith("data:image/png;base64,"))
            self.assertEqual(call.call_args_list[1].args[0], "/v1/videos/job%2Fid")

    def test_image_variants_route_to_the_exact_model(self):
        proxy = node.Proxy()
        for model in MODELS["image"]:
            with (
                self.subTest(model=model),
                patch.object(
                    proxy,
                    "call",
                    return_value={
                        "data": [{"b64_json": base64.b64encode(b"image").decode()}]
                    },
                ) as call,
            ):
                self.assertEqual(
                    proxy.image("draw", "1024x1024", model=model), b"image"
                )
                self.assertEqual(call.call_args.args[1]["model"], model)
                self.assertEqual(
                    proxy.image("edit", "1024x1024", b"reference", model=model),
                    b"image",
                )
                self.assertEqual(call.call_args.args[0], "/v1/images/edits")
                if model == "grok-imagine-image-2.0":
                    self.assertEqual(call.call_args.args[1]["model"], model)
                else:
                    self.assertIn(model.encode(), call.call_args.args[1])

    def test_image_2_uses_resolution_aspect_and_json_reference(self):
        proxy = node.Proxy()
        with patch.object(
            proxy,
            "call",
            return_value={"data": [{"b64_json": base64.b64encode(b"image").decode()}]},
        ) as call:
            proxy.image("draw", "1024x768", model="grok-imagine-image-2.0")
            body = call.call_args.args[1]
            self.assertEqual(body["aspect_ratio"], "4:3")
            self.assertEqual(body["resolution"], "1k")
            self.assertNotIn("size", body)
            self.assertNotIn("image", body)
            proxy.image(
                "edit", "1536x2048", b"reference", model="grok-imagine-image-2.0"
            )
            body = call.call_args.args[1]
            self.assertEqual(body["aspect_ratio"], "3:4")
            self.assertEqual(body["resolution"], "2k")
            self.assertEqual(
                body["image"],
                {
                    "type": "image_url",
                    "url": "data:image/png;base64,"
                    + base64.b64encode(b"reference").decode(),
                },
            )

    def test_video_variants_route_to_the_exact_model(self):
        proxy = node.Proxy()
        for model in MODELS["video"]:
            with (
                self.subTest(model=model),
                patch.object(
                    proxy,
                    "call",
                    side_effect=[
                        {"request_id": "job"},
                        {
                            "status": "done",
                            "video_url": "https://media.example/video.mp4",
                        },
                    ],
                ) as call,
                patch.object(node, "download", return_value=b"video"),
            ):
                self.assertEqual(
                    proxy.video("move", 1280, 720, 6, model=model), b"video"
                )
                self.assertEqual(call.call_args_list[0].args[1]["model"], model)

    def test_wrong_kind_and_unknown_models_are_rejected_before_submission(self):
        proxy = node.Proxy()
        with patch.object(proxy, "call") as call:
            with self.assertRaises(ValueError):
                proxy.image("draw", "1024x1024", model="grok-imagine-video")
            with self.assertRaises(ValueError):
                proxy.video("move", 1280, 720, 6, model="grok-imagine-image")
            with self.assertRaises(ValueError):
                proxy.image("draw", "1024x1024", model="unknown")
            call.assert_not_called()
        with patch.object(node, "Proxy") as constructor:
            with self.assertRaises(ValueError):
                node.GrokMedia().generate(
                    "image", "draw", 1024, 1024, 6, 1, model="grok-imagine-video"
                )
            constructor.assert_not_called()

    def test_explicit_node_models_reach_provider_and_output_metadata(self):
        image = io.BytesIO()
        Image.new("RGB", (16, 16)).save(image, format="PNG")
        for kind, models in MODELS.items():
            for model in models:
                with (
                    self.subTest(model=model),
                    tempfile.TemporaryDirectory() as directory,
                    patch.object(
                        node.folder_paths,
                        "get_output_directory",
                        return_value=directory,
                        create=True,
                    ),
                    patch.object(
                        node.Proxy,
                        kind,
                        return_value=image.getvalue() if kind == "image" else b"video",
                    ) as generate,
                ):
                    result = node.GrokMedia().generate(
                        kind, "original prompt", 1024, 1024, 6, 1, model=model
                    )
                    generate.assert_called_once()
                    self.assertEqual(generate.call_args.kwargs["model"], model)
                    record = result["ui"]["images" if kind == "image" else "videos"][0]
                    output = Path(directory) / record["subfolder"] / record["filename"]
                    metadata = json.loads(
                        output.with_suffix(output.suffix + ".json").read_text()
                    )
                    self.assertEqual(metadata["model"], model)
                    self.assertEqual(metadata["prompt"], "original prompt")
                    self.assertEqual(
                        metadata["resolution"],
                        "720p"
                        if kind == "video"
                        else "1k"
                        if model == "grok-imagine-image-2.0"
                        else None,
                    )
                    if kind == "image":
                        with Image.open(output) as saved:
                            self.assertIn(f"Model: {model}", saved.info["parameters"])

    def test_model_input_uses_discovery_and_omits_the_unused_seed(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(
                node.folder_paths,
                "get_input_directory",
                return_value=directory,
                create=True,
            ),
        ):
            schema = node.GrokMedia.INPUT_TYPES()
        self.assertEqual(
            schema["optional"]["model"][0],
            [""] + list(MODELS["image"]) + list(MODELS["video"]),
        )
        self.assertNotIn("seed", schema["required"])

    def test_explicit_duration_and_resolution_reach_video_provider(self):
        proxy = node.Proxy()
        for model, resolution in [
            ("grok-imagine-video", "480p"),
            ("grok-imagine-video-1.5", "1080p"),
        ]:
            with (
                self.subTest(model=model),
                patch.object(
                    proxy,
                    "call",
                    side_effect=[
                        {"request_id": "job"},
                        {
                            "status": "done",
                            "video_url": "https://media.example/out.mp4",
                        },
                    ],
                ) as call,
                patch.object(node, "download", return_value=b"video"),
            ):
                proxy.video(
                    "move",
                    1280,
                    720,
                    15,
                    b"reference",
                    model=model,
                    resolution=resolution,
                )
                body = call.call_args_list[0].args[1]
                self.assertEqual(body["duration"], 15)
                self.assertEqual(body["resolution"], resolution)
                self.assertEqual(body["model"], model)
                self.assertIn("image", body)
                self.assertNotIn("reference_images", body)

    def test_image_2_resolution_overrides_size_fallback(self):
        proxy = node.Proxy()
        with patch.object(
            proxy,
            "call",
            return_value={"data": [{"b64_json": base64.b64encode(b"image").decode()}]},
        ) as call:
            proxy.image(
                "draw", "1024x1024", model="grok-imagine-image-2.0", resolution="2k"
            )
            self.assertEqual(call.call_args.args[1]["resolution"], "2k")

    def test_bad_duration_or_model_resolution_is_rejected_before_provider_call(self):
        proxy = node.Proxy()
        with patch.object(proxy, "call") as call:
            for seconds in [0, 16, 2.5, True]:
                with self.subTest(seconds=seconds), self.assertRaises(ValueError):
                    proxy.video("move", 1280, 720, seconds)
            for model in ["grok-imagine-video"]:
                with self.subTest(model=model), self.assertRaises(ValueError):
                    proxy.video("move", 1280, 720, 6, model=model, resolution="1080p")
            for model in ["grok-imagine-image", "grok-imagine-image-quality"]:
                with self.subTest(model=model), self.assertRaises(ValueError):
                    proxy.image("draw", "1024x1024", model=model, resolution="2k")
            call.assert_not_called()

    def test_failed_video_does_not_resubmit(self):
        proxy = node.Proxy()
        with patch.object(
            proxy, "call", side_effect=[{"request_id": "job"}, {"status": "failed"}]
        ) as call:
            with self.assertRaises(RuntimeError):
                proxy.video("move", 1280, 720, 6)
            self.assertEqual(call.call_count, 2)

    def test_output_preserves_prompt_and_stays_in_instance(self):
        image = io.BytesIO()
        Image.new("RGB", (16, 16)).save(image, format="PNG")
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.object(
                    node.folder_paths,
                    "get_output_directory",
                    return_value=directory,
                    create=True,
                ),
                patch.object(node.Proxy, "image", return_value=image.getvalue()),
            ):
                result = node.GrokMedia().generate(
                    "image", "original prompt", 1024, 1024, 6, 1
                )
            record = result["ui"]["images"][0]
            path = Path(directory) / record["subfolder"] / record["filename"]
            with Image.open(path) as saved:
                self.assertIn("original prompt", saved.info["parameters"])
            metadata = json.loads(path.with_suffix(".png.json").read_text())
            self.assertEqual(metadata["prompt"], "original prompt")
            self.assertEqual(metadata["provider"], "cliproxyapi")
            self.assertEqual(metadata["model"], "grok-imagine-image-quality")
            self.assertNotIn("test-key", path.with_suffix(".png.json").read_text())

    def test_reference_cannot_cross_instance_directory(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(
                node.folder_paths,
                "get_input_directory",
                return_value=directory,
                create=True,
            ),
            patch.object(
                node.folder_paths,
                "get_annotated_filepath",
                return_value="/other-instance/secret.png",
                create=True,
            ),
            self.assertRaises(ValueError),
        ):
            node.GrokMedia().generate(
                "image", "edit", 1024, 1024, 6, 1, image="secret.png"
            )

    def test_download_does_not_send_provider_key(self):
        response = io.BytesIO(b"media")
        with patch.object(node.request, "urlopen", return_value=response) as opened:
            self.assertEqual(node.download("https://media.example/result"), b"media")
            self.assertEqual(opened.call_args.args, ("https://media.example/result",))
        with self.assertRaises(ValueError):
            node.download("file:///etc/passwd")

    def test_discovery_accepts_new_variants_and_filters_other_protocols(self):
        names = [
            "grok-imagine-image-next",
            "grok-imagine-video-next",
            "chat-model",
            "grok-imagine-image",
            "grok-imagine-image-next",
        ]
        with (
            patch.object(node, "available_models", discover_models),
            patch.dict(os.environ, CLIPROXYAPI_IMAGE_MODEL=""),
            patch.object(
                node.Proxy,
                "call",
                return_value={"data": [{"id": name} for name in names]},
            ) as call,
        ):
            models = node.available_models()
            self.assertEqual(
                models["image"], ("grok-imagine-image", "grok-imagine-image-next")
            )
            self.assertEqual(models["video"], ("grok-imagine-video-next",))
            self.assertEqual(node.media_model("image"), "grok-imagine-image")
            call.assert_called_once_with("/v1/models", timeout=5)

    def test_model_cache_expires(self):
        with (
            patch.object(node.Proxy, "call", return_value={"data": []}) as call,
            patch.object(node.time, "monotonic", return_value=0) as clock,
        ):
            discover_models()
            discover_models()
            self.assertEqual(call.call_count, 1)
            clock.return_value = 61
            discover_models()
            self.assertEqual(call.call_count, 2)

    def test_discovery_failure_has_no_static_model_fallback(self):
        with (
            patch.object(node, "available_models", discover_models),
            patch.object(
                node.Proxy, "call", side_effect=RuntimeError("provider offline")
            ),
            self.assertRaisesRegex(RuntimeError, "provider offline"),
        ):
            node.media_model("image")

    def test_configured_default_must_be_advertised(self):
        with (
            patch.dict(
                os.environ, CLIPROXYAPI_IMAGE_MODEL="grok-imagine-image-missing"
            ),
            self.assertRaisesRegex(ValueError, "advertised"),
        ):
            node.media_model("image")

    def test_provider_outage_does_not_break_the_node_schema(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(
                node.folder_paths,
                "get_input_directory",
                return_value=directory,
                create=True,
            ),
            patch.object(
                node, "available_models", side_effect=RuntimeError("provider offline")
            ),
        ):
            schema = node.GrokMedia.INPUT_TYPES()
        self.assertEqual(schema["optional"]["model"][0], [""])

    def test_new_advertised_models_use_provider_resolution_defaults(self):
        model = "grok-imagine-image-next"
        with (
            patch.object(
                node, "available_models", return_value={"image": (model,), "video": ()}
            ),
            patch.object(
                node.Proxy,
                "call",
                return_value={
                    "data": [{"b64_json": base64.b64encode(b"image").decode()}]
                },
            ) as call,
        ):
            proxy = node.Proxy()
            proxy.image("draw", "1024x1024", model=model)
            self.assertNotIn("resolution", call.call_args.args[1])
            proxy.image("draw", "1024x1024", model=model, resolution="4k")
            self.assertEqual(call.call_args.args[1]["resolution"], "4k")

    def test_poll_cancellation_does_not_resubmit_or_download(self):
        proxy = node.Proxy()
        interrupt = Mock(side_effect=[None, RuntimeError("cancelled")])
        with (
            patch.object(
                proxy,
                "call",
                side_effect=[{"request_id": "job"}, {"status": "pending"}],
            ) as call,
            patch.object(node, "download") as download,
            self.assertRaisesRegex(RuntimeError, "cancelled"),
        ):
            proxy.video("move", 1280, 720, 6, check_interrupt=interrupt)
        self.assertEqual(
            [item.args[0] for item in call.call_args_list],
            ["/v1/videos/generations", "/v1/videos/job"],
        )
        download.assert_not_called()

    def test_cancelling_an_image_batch_stops_before_the_next_output(self):
        with (
            patch.object(
                node, "check_cancelled", side_effect=[None, RuntimeError("cancelled")]
            ),
            patch.object(
                node.GrokMedia, "_generate_one", return_value={"ui": {"images": [{}]}}
            ) as generate,
            self.assertRaisesRegex(RuntimeError, "cancelled"),
        ):
            node.GrokMedia().generate("image", "draw", 1024, 1024, 6, count=3)
        generate.assert_called_once()

    def test_in_flight_wait_can_be_cancelled(self):
        started, release = threading.Event(), threading.Event()

        def operation():
            started.set()
            release.wait(5)
            return b"late result"

        def interrupt():
            if started.is_set():
                raise RuntimeError("cancelled")

        try:
            with self.assertRaisesRegex(RuntimeError, "cancelled"):
                node.interruptible(operation, interrupt)
        finally:
            release.set()

    def test_cancellation_before_dispatch_never_calls_the_provider(self):
        operation = Mock()
        interrupt = Mock(side_effect=RuntimeError("cancelled"))
        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            node.interruptible(operation, interrupt)
        operation.assert_not_called()


if __name__ == "__main__":
    unittest.main()
