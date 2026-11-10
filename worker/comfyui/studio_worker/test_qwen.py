"""Check the Qwen-Image 2.1 encoder skips the negative pass only at CFG 1, without ComfyUI or torch."""

import sys
import types
import unittest
from unittest.mock import patch

from studio_worker.qwen import StudioTextEncodeQwenImage21


class Tensor:
    def __init__(self, value):
        self.value = value


class Clip:
    def __init__(self):
        self.encoded = []

    def tokenize(self, text, **kwargs):
        return {"text": text, "images": kwargs["images"]}

    def encode_from_tokens_scheduled(self, tokens):
        self.encoded.append(tokens["text"])
        return [
            [Tensor(tokens["text"]), {"pooled_output": Tensor(1), "image_slots": [3]}]
        ]


class TextEncodeQwenImage21:
    """The ComfyUI 0.44.0 call order: positive, then negative, each with every image."""

    @classmethod
    def execute(
        cls, clip, prompt, negative_prompt, vae=None, resolution=1024, images=None
    ):
        images = list((images or {}).values())
        positive = clip.encode_from_tokens_scheduled(
            clip.tokenize(prompt, images=images)
        )
        negative = clip.encode_from_tokens_scheduled(
            clip.tokenize(negative_prompt, images=images)
        )
        return (positive, negative, {"samples": None})


class EncodeTests(unittest.TestCase):
    def setUp(self):
        modules = {
            "comfy_extras": types.ModuleType("comfy_extras"),
            "comfy_extras.nodes_qwen": types.SimpleNamespace(
                TextEncodeQwenImage21=TextEncodeQwenImage21
            ),
            "torch": types.SimpleNamespace(zeros_like=lambda tensor: Tensor(0)),
        }
        patcher = patch.dict(sys.modules, modules)
        patcher.start()
        self.addCleanup(patcher.stop)

    def encode(self, cfg):
        clip = Clip()
        positive, negative, passed = StudioTextEncodeQwenImage21().encode(
            clip, "edit", "", 1024, cfg, vae=object(), **{"images.image_1": object()}
        )
        return clip, positive, negative, passed

    def test_cfg_one_encodes_only_the_positive(self):
        clip, positive, negative, passed = self.encode(1.0)
        self.assertEqual(clip.encoded, ["edit"])
        self.assertEqual(positive[0][0].value, "edit")
        self.assertEqual(negative[0][0].value, 0)
        self.assertEqual(negative[0][1]["image_slots"], [3])
        self.assertEqual(negative[0][1]["pooled_output"].value, 0)
        self.assertEqual(passed, 1.0)

    def test_other_cfg_encodes_the_negative(self):
        clip, _, negative, passed = self.encode(4.0)
        self.assertEqual(clip.encoded, ["edit", ""])
        self.assertEqual(negative[0][0].value, "")
        self.assertEqual(passed, 4.0)


if __name__ == "__main__":
    unittest.main()
