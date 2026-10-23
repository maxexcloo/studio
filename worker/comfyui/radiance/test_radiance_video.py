import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from radiance.backend import Worker, stop_worker, video_command
from radiance.video import (
    generate_video,
    seconds,
    video_request,
)

STOCK, FAST = "minimax-h3-fp8.rad", "fasth3-8-step-v2-fp8.rad"


class VideoRequestTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.models = Path(folder.name)
        for name in [STOCK, FAST]:
            (self.models / name).touch()
        environment = patch.dict(
            "os.environ",
            RADIANCE_VIDEO_MODELS=str(self.models),
            HIP_VISIBLE_DEVICES="0,1",
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.values = {
            "model": STOCK,
            "prompt": "integrated_multimodal_description: [Shot 1] Waves.",
            "width": 1344,
            "height": 768,
            "frames": 192,
            "steps": 50,
            "latent_upscale": 1,
            "upscale_refine_steps": 0,
            "seed": 7,
        }

    def test_stock_request_keeps_its_steps_and_text_only_fields(self):
        body, frames = video_request(self.values)
        self.assertEqual(frames, 192)
        self.assertEqual(
            body,
            {
                "model": STOCK,
                "prompt": self.values["prompt"],
                "seconds": "8",
                "size": "1344x768",
                "seed": 7,
                "num_inference_steps": 50,
            },
        )

    def test_lora_stack_becomes_prompt_tags_and_the_worker_serves_the_library(self):
        loras = self.models / "loras"
        loras.mkdir()
        (loras / "h3_motion.safetensors").touch()
        with patch.dict("os.environ", RADIANCE_LORA_DIR=str(loras)):
            body, _ = video_request(
                {
                    **self.values,
                    "prompt": self.values["prompt"] + " <lora:typed:1>",
                    "loras": json.dumps(
                        [{"name": "h3_motion.safetensors", "strength": 0.8}]
                    ),
                }
            )
            self.assertEqual(
                body["prompt"], self.values["prompt"] + " <lora:h3_motion:0.8>"
            )
            args = video_command(STOCK)
            self.assertIn("--lora-dir", args)
            self.assertEqual(
                args[args.index("--max-loras") + 1 : args.index("--max-lora-rank") + 2],
                ["1", "--max-lora-rank", "64"],
            )
            with self.assertRaises(ValueError):
                video_request(
                    {
                        **self.values,
                        "loras": json.dumps(
                            [{"name": "missing.safetensors", "strength": 1}]
                        ),
                    }
                )

    def test_fasth3_owns_its_schedule_and_upscales_on_request(self):
        body, _ = video_request(dict(self.values, model=FAST, steps=8))
        self.assertNotIn("num_inference_steps", body)
        self.assertEqual(
            video_request(dict(self.values, model=FAST, steps=50))[0], body
        )
        body, _ = video_request(dict(self.values, model=FAST, latent_upscale=2))
        self.assertEqual(body["latent_upscale"], 2)
        self.assertNotIn("upscale_refine_steps", body)
        body, _ = video_request(
            dict(self.values, model=FAST, latent_upscale=2, upscale_refine_steps=4)
        )
        self.assertEqual(body["upscale_refine_steps"], 4)
        with self.assertRaisesRegex(ValueError, "8-step"):
            video_request(
                dict(self.values, model=FAST, latent_upscale=2, upscale_refine_steps=8)
            )

    def test_frames_follow_the_h3_grid_and_radiance_duration(self):
        # Radiance rounds seconds up to 17-frame steps, so stay just below the exact frame time.
        self.assertEqual(
            [seconds(value) for value in [124, 192, 345]], ["5.166", "8", "14.375"]
        )
        for frames in range(124, 346, 17):
            value = float(seconds(frames)) * 24
            self.assertTrue(frames - 17 < value <= frames, frames)
        for frames in range(124, 346, 17):
            body, actual = video_request(dict(self.values, frames=frames))
            self.assertEqual(actual, frames)
            self.assertEqual(body["seconds"], seconds(frames))
        for frames in [130, 362]:
            with self.subTest(frames=frames), self.assertRaises(ValueError):
                video_request(dict(self.values, frames=frames))

    def test_canvas_is_preserved_or_rejected_without_resizing(self):
        for width, height in [(1344, 768), (768, 1344), (992, 992), (512, 512)]:
            body, _ = video_request(dict(self.values, width=width, height=height))
            self.assertEqual(body["size"], f"{width}x{height}")
        for width, height in [(1024, 1024), (1568, 672), (2048, 2048)]:
            with (
                self.subTest(size=(width, height)),
                self.assertRaisesRegex(ValueError, "pixel area"),
            ):
                video_request(dict(self.values, width=width, height=height))

    def test_bounds_and_mounted_models(self):
        for change in [
            {"model": "other.rad"},
            {"width": 1000},
            {"frames": 100},
            {"frames": 400},
            {"steps": 66},
            {"latent_upscale": 3},
            {"seed": -1},
            {"seed": True},
            {"prompt": "  "},
        ]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                video_request(dict(self.values, **change))

    def test_worker_requires_both_visible_gpus_and_loopback(self):
        args = video_command(STOCK)
        self.assertEqual(args[args.index("--tp") + 1], "2")
        self.assertEqual(args[args.index("--vision-tower-placement") + 1], "ram")
        self.assertEqual(args[args.index("--host") + 1], "127.0.0.1")
        self.assertEqual(args[args.index("--model") + 1], str(self.models / STOCK))
        self.assertNotIn("--api-key", args)
        for devices in ["1", "0", ""]:
            with (
                self.subTest(devices=devices),
                patch.dict("os.environ", HIP_VISIBLE_DEVICES=devices),
                self.assertRaisesRegex(ValueError, "both GPUs"),
            ):
                video_command(STOCK)

    def test_single_gpu_placement_fails_before_releasing_retained_workers(self):
        worker = Worker(video_command, "video", 900)
        with (
            patch.dict("os.environ", HIP_VISIBLE_DEVICES="1"),
            patch("radiance.backend.subprocess.Popen") as spawn,
            self.assertRaisesRegex(ValueError, "both GPUs"),
            worker.use(STOCK, lambda: None),
        ):
            self.fail("A single GPU must not start H3.")
        spawn.assert_not_called()

    def test_video_and_image_workers_are_released_together(self):
        with (
            patch("radiance.backend._worker") as image,
            patch("radiance.backend._video_worker") as video,
        ):
            stop_worker()
        image.stop.assert_called_once()
        video.stop.assert_called_once()


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, route, body=None, raw=False, timeout=None):
        self.calls.append((method, route))
        if method == "DELETE":
            return 200, {}
        return self.responses.pop(0)


class VideoJobTests(unittest.TestCase):
    def test_polls_downloads_and_frees_the_job(self):
        client = FakeClient(
            [
                (200, {"id": "video_1", "status": "queued"}),
                (200, {"id": "video_1", "status": "in_progress", "progress": 40}),
                (200, {"id": "video_1", "status": "completed", "progress": 100}),
                (200, b"mp4"),
            ]
        )
        progress = []
        self.assertEqual(
            generate_video(
                {"prompt": "x"}, lambda: None, client, progress.append, poll=0
            ),
            b"mp4",
        )
        self.assertEqual(
            client.calls,
            [
                ("POST", "/v1/videos"),
                ("GET", "/v1/videos/video_1"),
                ("GET", "/v1/videos/video_1"),
                ("GET", "/v1/videos/video_1/content"),
                ("DELETE", "/v1/videos/video_1"),
            ],
        )
        self.assertEqual(progress, [40, 100])

    def test_rejection_and_failure_report_radiance_messages(self):
        client = FakeClient([(400, {"error": {"message": "size exceeds 1344x768"}})])
        with self.assertRaisesRegex(RuntimeError, "size exceeds"):
            generate_video({}, lambda: None, client, poll=0)
        self.assertEqual(client.calls, [("POST", "/v1/videos")])
        client = FakeClient(
            [
                (200, {"id": "video_2", "status": "queued"}),
                (
                    200,
                    {
                        "id": "video_2",
                        "status": "failed",
                        "error": {"message": "out of memory"},
                    },
                ),
            ]
        )
        with self.assertRaisesRegex(RuntimeError, "out of memory"):
            generate_video({}, lambda: None, client, poll=0)
        self.assertEqual(client.calls[-1], ("DELETE", "/v1/videos/video_2"))

    def test_cancellation_deletes_the_running_job(self):
        client = FakeClient([(200, {"id": "video_3", "status": "in_progress"})])
        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            generate_video(
                {}, Mock(side_effect=RuntimeError("cancelled")), client, poll=0
            )
        self.assertEqual(
            client.calls, [("POST", "/v1/videos"), ("DELETE", "/v1/videos/video_3")]
        )

    def test_unsafe_job_identifiers_are_refused(self):
        client = FakeClient([(200, {"id": "../admin", "status": "queued"})])
        with self.assertRaisesRegex(RuntimeError, "identifier"):
            generate_video({}, lambda: None, client, poll=0)
