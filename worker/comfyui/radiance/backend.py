"""Reuse one Radiance worker within a ComfyUI container's serial queue."""

import atexit
import io
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from collections import deque
from contextlib import contextmanager
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8000

RUNTIME = [
    "/opt/radiance/runtime/ld-linux-x86-64.so.2",
    "--library-path",
    "/opt/radiance/runtime/lib",
    "/opt/radiance/bin/radiance",
]


def mounted_models(variable, default):
    folder = Path(os.environ.get(variable, default))
    return {path.name: path for path in sorted(folder.glob("*.rad")) if path.is_file()}


def available_models():
    return mounted_models("RADIANCE_IMAGE_MODELS", "/models/radiance-image")


def available_video_models():
    return mounted_models("RADIANCE_VIDEO_MODELS", "/models/radiance-video")


def lora_folder():
    return Path(os.environ.get("RADIANCE_LORA_DIR", "/root/ComfyUI/models/loras"))


def has_lora_folder():
    try:
        return lora_folder().is_dir()
    except OSError:
        return False


def available_loras():
    folder = lora_folder()
    # Names match Studio's LoRA list: relative to the library, with subfolders and extension.
    try:
        return {
            path.relative_to(folder).as_posix()
            for path in folder.rglob("*.safetensors")
            if path.is_file()
        }
    except OSError:
        return set()


LORA_TAG = re.compile(r"<lora:[^>]*>", re.IGNORECASE)


def lora_tags(value):
    """Turn Studio's JSON LoRA stack into Radiance <lora:name:strength> prompt tags."""
    try:
        stack = json.loads(value or "[]")
    except ValueError:
        raise ValueError("The LoRA stack must be a JSON list.") from None
    if not isinstance(stack, list) or len(stack) > 8:
        raise ValueError("Radiance accepts a list of up to eight LoRAs.")
    if not stack:
        return []
    installed = available_loras()
    tags = []
    for item in stack:
        name = item.get("name") if isinstance(item, dict) else None
        weight = item.get("strength") if isinstance(item, dict) else None
        if name not in installed or any(character in name for character in ":<>"):
            raise ValueError(f"Choose an installed LoRA: {name}")
        if (
            isinstance(weight, bool)
            or not isinstance(weight, (int, float))
            or not math.isfinite(weight)
            or not -10 <= weight <= 10
        ):
            raise ValueError(f"LoRA strength must be a number from -10 to 10: {name}")
        tags.append(f"<lora:{name.removesuffix('.safetensors')}:{weight:g}>")
    return tags


def pngs(batches):
    """Encode every picture of the connected ComfyUI IMAGE batches, in input order, as PNG."""
    import numpy as np
    from PIL import Image

    encoded = []
    for batch in batches:
        if batch is None:
            continue
        for tensor in batch:
            array = (
                (tensor.detach().cpu().numpy().clip(0, 1) * 255)
                .round()
                .astype(np.uint8)
            )
            stream = io.BytesIO()
            Image.fromarray(array).save(stream, format="PNG")
            encoded.append(stream.getvalue())
    return encoded


def multipart(fields, files):
    """A form of text fields and (field, PNG) parts, as Radiance's media requests take."""
    boundary = "ai-" + uuid.uuid4().hex
    chunks = []
    for name, value in fields.items():
        if isinstance(value, bool):
            value = json.dumps(value)
        chunks.append(
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'
            ).encode()
        )
    for index, (name, data) in enumerate(files):
        header = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="reference-{index}.png"\r\nContent-Type: image/png\r\n\r\n'
        chunks.extend([header.encode(), data, b"\r\n"])
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), "multipart/form-data; boundary=" + boundary


def visible_devices():
    return [
        device
        for device in os.environ.get("HIP_VISIBLE_DEVICES", "").split(",")
        if device.strip()
    ]


def command(model):
    models = available_models()
    if model not in models:
        raise ValueError("Choose an available Radiance image model for this account.")
    return [
        *RUNTIME,
        "--host",
        HOST,
        "--model",
        str(models[model]),
        "--port",
        str(PORT),
        "--served-model-name",
        model,
        "--tp",
        "1",
        # Requests name LoRAs from the worker's read-only library with <lora:name:strength> tags.
        *(["--lora-dir", str(lora_folder())] if has_lora_folder() else []),
    ]


def video_command(model):
    models = available_video_models()
    if model not in models:
        raise ValueError("Choose an available Radiance video model for this account.")
    # H3 shards across two cards; a single-GPU allocation cannot load it.
    if len(visible_devices()) != 2:
        raise ValueError(
            "Radiance H3 requires an allocation exposing both GPUs through HIP_VISIBLE_DEVICES."
        )
    return [
        *RUNTIME,
        "--host",
        HOST,
        "--model",
        str(models[model]),
        "--port",
        str(PORT),
        "--served-model-name",
        model,
        "--tp",
        "2",
        "--vision-tower-placement",
        "ram",
        # Radiance 1.10.0 stops H3 startup ("VRAM pool budgets are empty") once LoRA slots pass
        # about 1.2 GiB; one rank-64 slot holds a request's whole stack in this serial queue.
        *(
            [
                "--lora-dir",
                str(lora_folder()),
                "--max-loras",
                "1",
                "--max-lora-rank",
                "64",
            ]
            if has_lora_folder()
            else []
        ),
    ]


class Worker:
    def __init__(self, build=command, kind="image", startup_seconds=180):
        self.build = build
        self.kind = kind
        self.startup_seconds = startup_seconds
        self.lock = threading.RLock()
        self.model = None
        self.process = None
        # Radiance's own error lines, so a failed start names its reason in the job error.
        self.errors = deque(maxlen=8)

    def stop(self):
        with self.lock:
            process = self.process
            if process is None:
                return
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            self.model = None
            self.process = None

    def forward(self, stream):
        # Keep the service log complete while remembering Radiance's error lines.
        for line in stream or ():
            sys.stderr.write(line)
            if line.startswith("E"):
                self.errors.append(line.strip())

    def ready(self, check_interrupt):
        deadline = time.monotonic() + self.startup_seconds
        while True:
            check_interrupt()
            if self.process.poll() is not None:
                reason = " ".join(self.errors) or f"Check the {self.kind} service logs."
                raise RuntimeError(
                    f"Radiance stopped while loading the {self.kind} model. {reason}"
                )
            try:
                with urllib.request.urlopen(
                    f"http://{HOST}:{PORT}/health", timeout=0.5
                ) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"Radiance did not become ready within {self.startup_seconds // 60} minutes."
                )
            time.sleep(0.1)

    @contextmanager
    def use(self, model, check_interrupt, prepare=None):
        args = self.build(model)  # Validate account access before changing the worker.
        with self.lock:
            try:
                check_interrupt()
                if (
                    self.model != model
                    or self.process is None
                    or self.process.poll() is not None
                ):
                    self.stop()
                    if prepare is not None:
                        prepare()
                    environment = dict(os.environ)
                    environment.pop("HSA_OVERRIDE_GFX_VERSION", None)
                    self.errors.clear()
                    self.process = subprocess.Popen(
                        args,
                        env=environment,
                        stdin=subprocess.DEVNULL,
                        stderr=subprocess.PIPE,
                        text=True,
                        errors="replace",
                    )
                    threading.Thread(
                        target=self.forward, args=(self.process.stderr,), daemon=True
                    ).start()
                    self.model = model
                self.ready(check_interrupt)
                yield
            except BaseException:
                # Cancellation and failures must release the cards before the next job.
                self.stop()
                raise


_worker = Worker()
# Loading 60+ GiB with pinned host buffers across two cards takes minutes.
_video_worker = Worker(video_command, "video", 900)
worker = _worker.use
video_worker = _video_worker.use


def stop_worker():
    """Both workers share the loopback endpoint; at most one runs."""
    _worker.stop()
    _video_worker.stop()


atexit.register(stop_worker)
