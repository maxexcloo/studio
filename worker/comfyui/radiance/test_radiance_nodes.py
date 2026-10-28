import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from radiance import RadianceImageGenerate, image_request


class ImageRequestTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.models = Path(folder.name)
        for name in ["qwen-image-2.1-turbo-fp8.rad", "noctq-v4-uncensored-fp8.rad"]:
            (self.models / name).touch()
        self.environment = patch.dict(
            "os.environ", RADIANCE_IMAGE_MODELS=str(self.models)
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.values = {
            "model": "qwen-image-2.1-turbo-fp8.rad",
            "prompt": "A red teapot.",
            "negative_prompt": "",
            "width": 1024,
            "height": 1024,
            "seed": 12,
            "count": 1,
            "steps": 8,
            "cfg": 1,
        }

    def test_fixed_schedule_ignores_carried_over_tuning(self):
        route, payload, content_type = image_request(self.values)
        self.assertEqual(route, "/v1/images/generations")
        self.assertEqual(content_type, "application/json")
        self.assertNotIn("num_inference_steps", json.loads(payload))
        _, changed_payload, _ = image_request(
            dict(self.values, steps=25, cfg=3, negative_prompt="Blurry.")
        )
        self.assertEqual(json.loads(changed_payload), json.loads(payload))

    def test_lora_stack_becomes_prompt_tags_for_installed_files(self):
        loras = self.models / "loras"
        (loras / "krea").mkdir(parents=True)
        (loras / "skin_detail.safetensors").touch()
        (loras / "krea/film grain, v2.safetensors").touch()
        stack = [
            {"name": "skin_detail.safetensors", "strength": 0.7},
            {"name": "krea/film grain, v2.safetensors", "strength": 1},
        ]
        with patch.dict("os.environ", RADIANCE_LORA_DIR=str(loras)):
            _, body, _ = image_request(
                {
                    **self.values,
                    "prompt": "A red teapot. <lora:typed:1>",
                    "loras": json.dumps(stack),
                }
            )
            self.assertEqual(
                json.loads(body)["prompt"],
                "A red teapot. <lora:skin_detail:0.7> <lora:krea/film grain, v2:1>",
            )
            _, body, _ = image_request({**self.values, "loras": "[]"})
            self.assertEqual(json.loads(body)["prompt"], "A red teapot.")
            for value in [
                "skin_detail.safetensors:1",
                '[{"name": "missing.safetensors", "strength": 1}]',
                '[{"name": "skin_detail.safetensors", "strength": "1"}]',
                '[{"name": "skin_detail.safetensors", "strength": 11}]',
            ]:
                with self.subTest(value=value), self.assertRaises(ValueError):
                    image_request({**self.values, "loras": value})

    def test_unmounted_model_cannot_be_selected(self):
        with self.assertRaisesRegex(ValueError, "available"):
            image_request(dict(self.values, model="another.rad"))

    def test_numeric_bounds(self):
        for change in [
            {"width": 1000},
            {"count": 9},
            {"seed": -1},
            {"cfg": float("nan")},
        ]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                image_request(dict(self.values, **change))
        _, payload, _ = image_request(dict(self.values, seed=2**64 - 1))
        self.assertEqual(json.loads(payload)["seed"], 2**64 - 1)

    def test_reference_uses_edit_api_and_multipart(self):
        route, payload, content_type = image_request(self.values, [b"png-reference"])
        self.assertEqual(route, "/v1/images/edits")
        self.assertIn("multipart/form-data; boundary=", content_type)
        self.assertIn(b'name="image[]"', payload)
        self.assertIn(b"png-reference", payload)
        with self.assertRaisesRegex(ValueError, "four reference"):
            image_request(self.values, [b"png"] * 5)

    def test_quality_guidance_needs_negative_prompt(self):
        model = "noctq-v4-uncensored-fp8.rad"
        values = dict(self.values, model=model, cfg=3, steps=25)
        with self.assertRaisesRegex(ValueError, "negative prompt"):
            image_request(values)
        _, payload, _ = image_request(dict(values, negative_prompt="Blurry."))
        self.assertEqual(json.loads(payload)["true_cfg_scale"], 3)
        self.assertEqual(json.loads(payload)["num_inference_steps"], 25)

    def test_krea_and_flux3_guidance_allow_an_empty_negative_prompt(self):
        for model in ["krea-2-raw-fp8.rad", "flux-3-klein-base-fp8.rad"]:
            (self.models / model).touch()
            _, payload, _ = image_request(
                dict(self.values, model=model, cfg=4.5, steps=28)
            )
            body = json.loads(payload)
            self.assertEqual(body["guidance_scale"], 4.5)
            self.assertNotIn("negative_prompt", body)
            self.assertNotIn("true_cfg_scale", body)

    def test_rebalance_is_sent_only_when_requested(self):
        (self.models / "krea-2-turbo-fp8.rad").touch()
        values = dict(self.values, model="krea-2-turbo-fp8.rad")
        self.assertNotIn("rebalance", json.loads(image_request(values)[1]))
        self.assertNotIn(
            "rebalance", json.loads(image_request(dict(values, rebalance="off"))[1])
        )
        for value in [True, "legacy", "balanced", "detail", "subtle"]:
            body = json.loads(image_request(dict(values, rebalance=value))[1])
            self.assertEqual(body["rebalance"], value)
        # Profiles saved with the old boolean pass ComfyUI's validation; Radiance reads true as legacy.
        self.assertIs(RadianceImageGenerate.VALIDATE_INPUTS(rebalance=True), True)
        self.assertIs(RadianceImageGenerate.VALIDATE_INPUTS(rebalance="detail"), True)
        self.assertIsInstance(RadianceImageGenerate.VALIDATE_INPUTS(rebalance="x"), str)

    def test_flux3_stays_under_two_megapixels(self):
        (self.models / "flux-3-klein-fp8.rad").touch()
        image_request(
            dict(self.values, model="flux-3-klein-fp8.rad", width=1408, height=1408)
        )
        with self.assertRaisesRegex(ValueError, "megapixels"):
            image_request(
                dict(self.values, model="flux-3-klein-fp8.rad", width=1536, height=1536)
            )
