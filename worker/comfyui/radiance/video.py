"""Radiance MiniMax H3 video jobs in ComfyUI's video queue."""

import gc
import http.client
import io
import json
import math
import time
from fractions import Fraction

from .backend import (
    HOST,
    LORA_TAG,
    PORT,
    available_video_models,
    lora_tags,
    multipart,
    pngs,
)

FPS = 24
# H3 lengths are 17n + 5 frames. Radiance renders 5.17 to 14.4 seconds (124 to 345 frames).
MIN_FRAMES, MAX_FRAMES, FRAME_STEP, FRAME_OFFSET = 124, 345, 17, 5
MAX_AREA = 1344 * 768
MAX_CONTENT_BYTES = 2 * 1024**3
TERMINAL_FAILURES = {"failed", "cancelled", "canceled", "expired"}
# H3's tasks: keyframe tasks name the form part of each picture in order; ref2va
# sends the pictures as numbered references.
KEYFRAMES = {
    "i2va": ["first_frame"],
    "l2va": ["last_frame"],
    "fl2va": ["first_frame", "last_frame"],
}
TASKS = ["t2va", *KEYFRAMES, "ref2va"]
MAX_REFERENCES = 9


def distilled(model):
    return "fasth3" in model.lower()


def seconds(frames):
    """Radiance rounds seconds up to the frame grid; stay just below the exact frame time."""
    exact = Fraction(frames, FPS)
    if exact.denominator == 1:
        return str(exact.numerator)
    return f"{math.floor(exact * 1000) / 1000:.3f}"


def video_request(values, images=()):
    """The job's fields and its (form part, PNG) media; `images` are in input order."""
    model = values["model"]
    if model not in available_video_models():
        raise ValueError("Choose an available Radiance video model for this account.")
    for name, minimum, maximum in [
        ("frames", MIN_FRAMES, MAX_FRAMES),
        ("height", 256, 2048),
        ("latent_upscale", 1, 4),
        ("seed", 0, 2**64 - 1),
        ("steps", 1, 65),
        ("upscale_refine_steps", 0, 65),
        ("width", 256, 2048),
    ]:
        value = values[name]
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not minimum <= value <= maximum
        ):
            raise ValueError(f"{name} must be an integer from {minimum} to {maximum}.")
    if values["width"] % 32 or values["height"] % 32:
        raise ValueError("Video dimensions must be multiples of 32.")
    if values["latent_upscale"] not in {1, 2, 4}:
        raise ValueError("Latent upscale must be 1 (off), 2 or 4.")
    task = values.get("task", "t2va")
    if task not in TASKS:
        raise ValueError(f"task must be one of {', '.join(TASKS)}.")
    if task != "t2va" and distilled(model):
        raise ValueError("FastH3 makes text-to-video only.")
    if task in KEYFRAMES:
        if len(images) != len(KEYFRAMES[task]):
            raise ValueError(f"{task} takes {len(KEYFRAMES[task])} image(s).")
        if values["latent_upscale"] > 1:
            raise ValueError("Keyframe videos take no latent upscale.")
        files = list(zip(KEYFRAMES[task], images))
    elif task == "ref2va":
        if not 1 <= len(images) <= MAX_REFERENCES:
            raise ValueError(f"ref2va takes 1 to {MAX_REFERENCES} reference images.")
        files = [(f"ref_image_{i}", data) for i, data in enumerate(images, 1)]
    elif images:
        raise ValueError("t2va takes no images; choose a keyframe or reference task.")
    else:
        files = []
    if not values["prompt"].strip():
        raise ValueError("Enter a video prompt.")
    width, height = values["width"], values["height"]
    frames = values["frames"]
    if width * height > MAX_AREA:
        raise ValueError("Video dimensions exceed Radiance's 1344 × 768 pixel area.")
    if (frames - FRAME_OFFSET) % FRAME_STEP:
        raise ValueError("Video frames must follow the 17n + 5 frame grid.")
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
        "seconds": seconds(frames),
        "size": f"{width}x{height}",
        "seed": values["seed"],
    }
    # FastH3 runs only its trained eight-step schedule; ignore tuning carried over
    # from another profile instead of failing an otherwise valid job.
    total = 8 if distilled(model) else values["steps"]
    if not distilled(model):
        body["num_inference_steps"] = values["steps"]
    # Radiance reads text to video off a request without media.
    if task != "t2va":
        body["task"] = task
    if values["latent_upscale"] > 1:
        body["latent_upscale"] = values["latent_upscale"]
        if values["upscale_refine_steps"]:
            if values["upscale_refine_steps"] >= total:
                raise ValueError(
                    f"Upscale refine steps must be below the {total}-step schedule."
                )
            body["upscale_refine_steps"] = values["upscale_refine_steps"]
    return body, files


def error_message(data, fallback):
    error = data.get("error") if isinstance(data, dict) else None
    if isinstance(error, dict):
        error = error.get("message")
    return str(error or fallback)


class Client:
    """Short loopback requests so cancellation is observed between polls."""

    def __init__(self, host=HOST, port=PORT, timeout=30):
        self.host, self.port, self.timeout = host, port, timeout

    def request(self, method, route, body=None, raw=False, timeout=None, files=()):
        connection = http.client.HTTPConnection(
            self.host, self.port, timeout=timeout or self.timeout
        )
        try:
            payload, headers = None, {}
            if files:
                payload, content_type = multipart(body, files)
                headers["Content-Type"] = content_type
            elif body is not None:
                payload = json.dumps(body).encode()
                headers["Content-Type"] = "application/json"
            connection.request(method, route, payload, headers)
            response = connection.getresponse()
            if raw and response.status == 200:
                length = int(response.getheader("Content-Length") or 0)
                if length > MAX_CONTENT_BYTES:
                    raise RuntimeError("Radiance returned an unexpectedly large video.")
                data = response.read(MAX_CONTENT_BYTES + 1)
                if len(data) > MAX_CONTENT_BYTES:
                    raise RuntimeError("Radiance returned an unexpectedly large video.")
                return response.status, data
            payload = response.read(1024**2)
            try:
                data = json.loads(payload) if payload else {}
            except ValueError:
                data = {"error": payload.decode(errors="replace")[:500]}
            return response.status, data
        finally:
            connection.close()


def generate_video(
    body,
    check_interrupt,
    client=None,
    progress=None,
    poll=1.0,
    deadline_seconds=3 * 3600,
    files=(),
):
    """Create, poll and download one job; cancellation deletes the Radiance job."""
    client = client or Client()
    status, job = client.request("POST", "/v1/videos", body, files=files)
    if status not in {200, 201, 202} or not isinstance(job, dict) or not job.get("id"):
        raise RuntimeError(error_message(job, "Radiance rejected the video request."))
    identifier = str(job["id"])
    if not identifier.replace("_", "").replace("-", "").isalnum():
        raise RuntimeError("Radiance returned an invalid video job identifier.")
    route = "/v1/videos/" + identifier
    try:
        deadline = time.monotonic() + deadline_seconds
        while True:
            state = job.get("status")
            if progress is not None and isinstance(job.get("progress"), (int, float)):
                progress(max(0, min(100, int(job["progress"]))))
            if state == "completed":
                break
            if state in TERMINAL_FAILURES:
                raise RuntimeError(error_message(job, f"Radiance video job {state}."))
            if time.monotonic() >= deadline:
                raise TimeoutError("Radiance did not finish the video in time.")
            started = time.monotonic()
            while True:
                check_interrupt()
                if time.monotonic() - started >= poll:
                    break
                time.sleep(min(0.1, poll))
            status, job = client.request("GET", route)
            if status != 200 or not isinstance(job, dict):
                raise RuntimeError(error_message(job, "Radiance lost the video job."))
        check_interrupt()
        status, data = client.request("GET", route + "/content", raw=True)
        if status != 200 or not isinstance(data, bytes) or not data:
            raise RuntimeError(
                error_message(data, "Radiance returned no video content.")
            )
        return data
    finally:
        # Free the job after download, failure or cancellation; a cancelled worker is stopped next.
        try:
            client.request("DELETE", route, timeout=5)
        except Exception:  # noqa: BLE001, S110 -- Cleanup must preserve the generation error or cancellation.
            pass


def audio_from_mp4(data):
    """Decode only the AAC stream into Comfy's AUDIO mapping."""
    import av
    import numpy as np
    import torch

    with av.open(io.BytesIO(data), mode="r") as container:
        if not container.streams.audio:
            return {"waveform": torch.zeros((1, 2, 0)), "sample_rate": 32000}
        stream = container.streams.audio[0]
        chunks, rate = [], stream.rate or 32000
        for frame in container.decode(stream):
            samples = frame.to_ndarray()
            if samples.ndim == 1:
                samples = samples.reshape(1, -1)
            elif frame.format.is_packed:
                samples = samples.reshape(-1, len(frame.layout.channels)).T
            chunks.append(samples.astype(np.float32))
            rate = frame.sample_rate or rate
    waveform = (
        np.concatenate(chunks, axis=1) if chunks else np.zeros((2, 0), dtype=np.float32)
    )
    return {"waveform": torch.from_numpy(waveform).unsqueeze(0), "sample_rate": rate}


class RadianceVideoGenerate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": (list(available_video_models()),),
                "prompt": ("STRING", {"multiline": True}),
                "width": (
                    "INT",
                    {"default": 1344, "min": 256, "max": 2048, "step": 32},
                ),
                "height": (
                    "INT",
                    {"default": 768, "min": 256, "max": 2048, "step": 32},
                ),
                "frames": (
                    "INT",
                    {
                        "default": 192,
                        "min": MIN_FRAMES,
                        "max": MAX_FRAMES,
                        "step": FRAME_STEP,
                    },
                ),
                "steps": ("INT", {"default": 50, "min": 1, "max": 65}),
                "latent_upscale": ("INT", {"default": 1, "min": 1, "max": 4}),
                "upscale_refine_steps": ("INT", {"default": 0, "min": 0, "max": 65}),
                "seed": ("INT", {"default": 1, "min": 0, "max": 2**64 - 1}),
            },
            "optional": {
                # Studio's optional reference slots drop unused `images.*` inputs (workflow-modes.js).
                **{
                    f"images.image_{index}": ("IMAGE",)
                    for index in range(1, MAX_REFERENCES + 1)
                },
                "loras": ("STRING", {"default": "[]"}),
                "task": (TASKS, {"default": "t2va"}),
            },
        }

    RETURN_TYPES = ("VIDEO", "AUDIO")
    RETURN_NAMES = ("video", "audio")
    FUNCTION = "generate"
    CATEGORY = "Radiance"

    def generate(self, **values):
        import comfy.model_management
        import comfy.utils
        from comfy_api.latest import InputImpl

        from .backend import stop_worker, video_worker

        images = pngs(
            [
                values.pop(f"images.image_{index}", None)
                for index in range(1, MAX_REFERENCES + 1)
            ]
        )
        body, files = video_request(values, images)

        def prepare():
            stop_worker()
            comfy.model_management.unload_all_models()
            # Drop unloaded ComfyUI weights now; Radiance pins host memory and needs the VRAM.
            gc.collect()
            comfy.model_management.soft_empty_cache()

        bar = comfy.utils.ProgressBar(100)
        check_interrupt = (
            comfy.model_management.throw_exception_if_processing_interrupted
        )
        with video_worker(values["model"], check_interrupt, prepare):
            data = generate_video(
                body,
                check_interrupt,
                progress=lambda value: bar.update_absolute(value, 100),
                files=files,
            )
        # The MP4 is stream-copied by SaveVideo (format and codec auto).
        return (InputImpl.VideoFromFile(io.BytesIO(data)), audio_from_mp4(data))
