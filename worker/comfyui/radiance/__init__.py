"""Radiance generation in ComfyUI's image and video queues, with account-scoped model access."""

import base64
import gc
import http.client
import io
import json
import math
import os
import queue
import socket
import sys
import threading
import uuid

from .backend import HOST, LORA_TAG, PORT, available_models, lora_tags, worker
from .video import RadianceVideoGenerate

NEGATIVE_OPTIONAL = ("flux-3-", "krea-2-")
# Radiance's FLUX.3 VAE decode fails above 2^21 pixels (1408 × 1408 works, 1536 × 1536 fails).
FLUX3_MAX_PIXELS = 2**21


def image_request(values, references=None):
    model = values["model"]
    if model not in available_models():
        raise ValueError("Choose an available Radiance image model for this account.")
    for name, minimum, maximum in [
        ("count", 1, 8),
        ("height", 64, 2048),
        ("seed", 0, 2**64 - 1),
        ("steps", 1, 80),
        ("width", 64, 2048),
    ]:
        value = values[name]
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not minimum <= value <= maximum
        ):
            raise ValueError(f"{name} must be an integer from {minimum} to {maximum}.")
    if values["width"] % 32 or values["height"] % 32:
        raise ValueError("Image dimensions must be multiples of 32.")
    if (
        model.startswith("flux-3-")
        and values["width"] * values["height"] > FLUX3_MAX_PIXELS
    ):
        raise ValueError(
            "FLUX.3 on Radiance supports up to about 2 megapixels, such as 1408 × 1408."
        )
    if not math.isfinite(values["cfg"]) or not 1 <= values["cfg"] <= 10:
        raise ValueError("Guidance must be between 1 and 10.")
    if not values["prompt"].strip():
        raise ValueError("Enter an image prompt.")
    # Only the profile's stack chooses LoRAs; tags typed into the prompt are dropped.
    prompt = " ".join(
        [
            LORA_TAG.sub("", values["prompt"]).strip(),
            *lora_tags(values.get("loras", "")),
        ]
    )
    body = {
        "model": model,
        "prompt": prompt,
        "size": f"{values['width']}x{values['height']}",
        "seed": values["seed"],
        "n": values["count"],
        "output_format": "png",
    }
    # Turbo owns its eight-step, guidance-1 schedule. Ignore tuning carried over
    # from another UI profile rather than failing an otherwise valid job.
    if "turbo" not in model:
        body["num_inference_steps"] = values["steps"]
    if "turbo" not in model and values["cfg"] > 1:
        negative = values["negative_prompt"].strip()
        # Krea 2 and FLUX.3 guide against an empty negative by default; Qwen-Image needs one.
        if model.startswith(NEGATIVE_OPTIONAL):
            body["guidance_scale"] = values["cfg"]
        elif not negative:
            raise ValueError("Guidance above 1 requires a negative prompt.")
        else:
            body["true_cfg_scale"] = values["cfg"]
        if negative:
            body["negative_prompt"] = values["negative_prompt"]
    if not references:
        return "/v1/images/generations", json.dumps(body).encode(), "application/json"
    if len(references) > 4:
        raise ValueError(
            "The single-GPU image backend supports up to four reference images."
        )
    boundary = "ai-" + uuid.uuid4().hex
    chunks = []
    for name, value in body.items():
        chunks.append(
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'
            ).encode()
        )
    for index, data in enumerate(references):
        header = f'--{boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="reference-{index}.png"\r\nContent-Type: image/png\r\n\r\n'
        chunks.extend([header.encode(), data, b"\r\n"])
    chunks.append(f"--{boundary}--\r\n".encode())
    return (
        "/v1/images/edits",
        b"".join(chunks),
        "multipart/form-data; boundary=" + boundary,
    )


def call_radiance(route, body, content_type, check_interrupt):
    """Interrupting the Comfy job closes only its own HTTP generation request."""
    connection = http.client.HTTPConnection(HOST, PORT, timeout=600)
    result = queue.Queue(maxsize=1)

    def request():
        try:
            connection.request(
                "POST",
                route,
                body,
                {
                    "Content-Type": content_type,
                },
            )
            response = connection.getresponse()
            data = json.loads(response.read())
            if response.status != 200:
                message = data.get("error", {})
                if isinstance(message, dict):
                    message = message.get(
                        "message", "Radiance rejected the image request."
                    )
                raise RuntimeError(str(message))
            result.put((True, data))
        except Exception as error:  # noqa: BLE001 -- Return every worker-thread error to its caller.
            result.put((False, error))
        finally:
            connection.close()

    thread = threading.Thread(target=request, daemon=True)
    thread.start()
    try:
        while thread.is_alive():
            check_interrupt()
            thread.join(0.1)
        succeeded, value = result.get()
        if not succeeded:
            raise value
        return value
    finally:
        if connection.sock is not None:
            try:
                connection.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        connection.close()


class RadianceImageGenerate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": (list(available_models()),),
                "prompt": ("STRING", {"multiline": True}),
                "negative_prompt": ("STRING", {"default": "", "multiline": True}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 2048, "step": 32}),
                "height": (
                    "INT",
                    {"default": 1024, "min": 64, "max": 2048, "step": 32},
                ),
                "steps": (
                    "INT",
                    {
                        "default": int(os.environ.get("RADIANCE_IMAGE_STEPS", "8")),
                        "min": 1,
                        "max": 80,
                    },
                ),
                "cfg": (
                    "FLOAT",
                    {
                        "default": float(os.environ.get("RADIANCE_IMAGE_CFG", "1")),
                        "min": 1,
                        "max": 10,
                        "step": 0.1,
                    },
                ),
                "seed": ("INT", {"default": 1, "min": 0, "max": 2**64 - 1}),
                "count": ("INT", {"default": 1, "min": 1, "max": 8}),
            },
            "optional": {
                "reference_image": ("IMAGE",),
                "loras": ("STRING", {"default": "[]"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "generate"
    CATEGORY = "Radiance"

    def generate(self, reference_image=None, **values):
        import comfy.model_management
        import numpy as np
        import torch
        from PIL import Image

        references = []
        if reference_image is not None:
            for tensor in reference_image:
                array = (
                    (tensor.detach().cpu().numpy().clip(0, 1) * 255)
                    .round()
                    .astype(np.uint8)
                )
                stream = io.BytesIO()
                Image.fromarray(array).save(stream, format="PNG")
                references.append(stream.getvalue())
        request = image_request(values, references)

        def prepare():
            comfy.model_management.unload_all_models()
            # Drop unloaded ComfyUI weights now; Radiance pins host memory and needs the VRAM.
            gc.collect()
            comfy.model_management.soft_empty_cache()

        check_interrupt = (
            comfy.model_management.throw_exception_if_processing_interrupted
        )
        with worker(values["model"], check_interrupt, prepare):
            response = call_radiance(*request, check_interrupt)
        pictures = []
        for item in response.get("data", []):
            image = Image.open(
                io.BytesIO(base64.b64decode(item["b64_json"], validate=True))
            ).convert("RGB")
            pictures.append(torch.from_numpy(np.array(image).astype(np.float32) / 255))
        if not pictures:
            raise RuntimeError("Radiance returned no generated images.")
        return (torch.stack(pictures),)


NODE_CLASS_MAPPINGS = {
    "RadianceImageGenerate": RadianceImageGenerate,
    "RadianceVideoGenerate": RadianceVideoGenerate,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "RadianceImageGenerate": "Radiance Image",
    "RadianceVideoGenerate": "Radiance Video",
}

# ComfyUI imports execution before loading custom nodes. Request-building tests
# can import this module without installing ComfyUI or its GPU dependencies.
if "execution" in sys.modules:
    import comfy.model_management

    from .lifecycle import install_hooks

    install_hooks(sys.modules["execution"], comfy.model_management)
