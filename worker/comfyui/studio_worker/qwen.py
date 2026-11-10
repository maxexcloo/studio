"""Qwen-Image 2.1 prompt encoding without the negative pass that CFG 1 never reads.

ComfyUI's TextEncodeQwenImage21 always encodes the prompt and the negative prompt, each with every
reference image, so a reference edit pays for the 8B vision-language encoder twice. This node runs
the same upstream node, but at CFG 1, where ComfyUI's samplers skip the negative, it answers the
negative encode with zeroed conditioning instead. It passes CFG on so the sampler and this check
read one value.
"""

import math

IMAGES = 16  # TextEncodeQwenImage21's image_1 … image_16 inputs (ComfyUI 0.44.0)


class PositiveOnlyClip:
    """Encodes the first (positive) prompt; later encodes return its conditioning zeroed."""

    def __init__(self, clip):
        self.clip = clip
        self.positive = None

    def tokenize(self, *args, **kwargs):
        return self.clip.tokenize(*args, **kwargs)

    def encode_from_tokens_scheduled(self, *args, **kwargs):
        if self.positive is None:
            self.positive = self.clip.encode_from_tokens_scheduled(*args, **kwargs)
            return self.positive
        import torch

        # As ConditioningZeroOut: keep the extras (attention mask, image slots), zero the tensors.
        zeroed = []
        for cond, extra in self.positive:
            extra = extra.copy()
            if extra.get("pooled_output") is not None:
                extra["pooled_output"] = torch.zeros_like(extra["pooled_output"])
            zeroed.append([torch.zeros_like(cond), extra])
        return zeroed


class StudioTextEncodeQwenImage21:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "prompt": ("STRING", {"multiline": True, "dynamicPrompts": True}),
                "negative_prompt": (
                    "STRING",
                    {"multiline": True, "dynamicPrompts": True},
                ),
                "resolution": (
                    "INT",
                    {"default": 1024, "min": 0, "max": 4096, "step": 32},
                ),
                "cfg": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 100.0, "step": 0.1},
                ),
            },
            "optional": {
                "vae": ("VAE",),
                # Studio's optional reference slots drop unused `images.*` inputs (workflow-modes.js).
                **{
                    f"images.image_{index}": ("IMAGE",)
                    for index in range(1, IMAGES + 1)
                },
            },
        }

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING", "FLOAT")
    RETURN_NAMES = ("positive", "negative", "cfg")
    FUNCTION = "encode"
    CATEGORY = "Studio"

    def encode(
        self, clip, prompt, negative_prompt, resolution, cfg, vae=None, **images
    ):
        from comfy_extras.nodes_qwen import TextEncodeQwenImage21

        if math.isclose(cfg, 1.0):
            clip = PositiveOnlyClip(clip)
        output = TextEncodeQwenImage21.execute(
            clip,
            prompt,
            negative_prompt,
            vae=vae,
            resolution=resolution,
            images={
                name.removeprefix("images."): image for name, image in images.items()
            },
        )
        return (output[0], output[1], cfg)
