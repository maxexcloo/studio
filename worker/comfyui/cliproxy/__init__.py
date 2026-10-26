"""Grok media through the configured CLIProxyAPI; outputs stay in this ComfyUI instance."""

import base64
import io
import json
import math
import os
import queue
import threading
import time
import uuid
from pathlib import Path
from urllib import error, parse, request

import folder_paths
from PIL import Image, PngImagePlugin

MODEL_PREFIXES = {
    "image": "grok-imagine-image",
    "video": "grok-imagine-video",
}
# The model list does not publish per-model resolution or request-format contracts.
RESOLUTIONS = {
    "grok-imagine-image": (),
    "grok-imagine-image-2.0": ("1k", "2k"),
    "grok-imagine-image-quality": (),
    "grok-imagine-video": ("480p", "720p"),
    "grok-imagine-video-1.5": ("480p", "720p", "1080p"),
}
_model_cache = None
_model_lock = threading.Lock()
_schema_refresh = None


def available_models():
    """Discover advertised Grok models; cache for one minute per provider credential."""
    global _model_cache
    proxy = Proxy()
    identity = (proxy.base, proxy.key)
    with _model_lock:
        if _model_cache is not None:
            previous, expires, models = _model_cache
            if previous == identity and time.monotonic() < expires:
                return models
        result = proxy.call("/v1/models", timeout=5)
        if not isinstance(result, dict) or not isinstance(result.get("data"), list):
            raise TypeError("CLIProxyAPI returned an invalid model catalogue.")
        identifiers = {
            item["id"]
            for item in result["data"]
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        }
        models = {
            kind: tuple(
                sorted(
                    identifier
                    for identifier in identifiers
                    if identifier == prefix or identifier.startswith(prefix + "-")
                )
            )
            for kind, prefix in MODEL_PREFIXES.items()
        }
        _model_cache = (identity, time.monotonic() + 60, models)
        return models


def schema_models():
    """Never wait for provider discovery on ComfyUI's HTTP event loop."""
    global _schema_refresh
    proxy = Proxy()
    identity = (proxy.base, proxy.key)
    cached = _model_cache
    models = (
        cached[2]
        if cached is not None and cached[0] == identity
        else {kind: () for kind in MODEL_PREFIXES}
    )
    if not _model_lock.acquire(blocking=False):
        return models
    try:
        now = time.monotonic()
        if cached is not None and cached[0] == identity and now < cached[1]:
            return models
        if (
            _schema_refresh is not None
            and _schema_refresh[0] == identity
            and now < _schema_refresh[1]
        ):
            return models
        # Failed discovery also backs off, rather than blocking every /object_info.
        _schema_refresh = (identity, now + 60)

        def refresh():
            try:
                available_models()
            except (OSError, RuntimeError, TypeError, ValueError):
                pass

        threading.Thread(target=refresh, daemon=True, name="cliproxy-models").start()
        return models
    finally:
        _model_lock.release()


def media_model(kind, model=""):
    prefix = MODEL_PREFIXES.get(kind)
    if prefix is None:
        raise ValueError("Unsupported media kind.")
    selected = model or os.environ.get(f"CLIPROXYAPI_{kind.upper()}_MODEL", "")
    if selected and selected != prefix and not selected.startswith(prefix + "-"):
        raise ValueError(f"Unsupported {kind} model: {selected}.")
    choices = available_models()[kind]
    selected = selected or next(iter(choices), "")
    if not selected or selected not in choices:
        raise ValueError(f"Choose an advertised CLIProxyAPI {kind} model.")
    return selected


def media_resolution(kind, model, resolution="", width=1024, height=1024):
    selected = media_model(kind, model)
    allowed = RESOLUTIONS.get(selected)
    if allowed is None:
        # New advertised models use provider defaults unless explicitly overridden.
        return resolution
    if not allowed:
        if resolution:
            raise ValueError(f"Resolution is not adjustable for {selected}.")
        return ""
    fallback = (
        "720p" if kind == "video" else "2k" if max(width, height) > 1024 else "1k"
    )
    value = resolution or fallback
    if value not in allowed:
        raise ValueError(f"Unsupported resolution for {selected}: {value}.")
    return value


def interruptible(operation, check_interrupt=None):
    """Let ComfyUI cancel local waits without retrying or resubmitting provider work."""
    if check_interrupt is None:
        return operation()
    check_interrupt()
    result = queue.Queue(maxsize=1)

    def run():
        try:
            result.put((True, operation()))
        except BaseException as exc:  # noqa: BLE001
            # Relay every background-thread failure to the waiting caller.
            result.put((False, exc))

    threading.Thread(target=run, daemon=True).start()
    while True:
        check_interrupt()
        try:
            succeeded, value = result.get(timeout=0.1)
        except queue.Empty:
            continue
        check_interrupt()
        if not succeeded:
            raise value
        return value


def check_cancelled():
    import comfy.model_management

    comfy.model_management.throw_exception_if_processing_interrupted()


class Proxy:
    def __init__(self):
        self.base = os.environ.get("CLIPROXYAPI_URL", "").rstrip("/")
        self.key = os.environ.get("CLIPROXYAPI_KEY", "")
        parsed = parse.urlsplit(self.base)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
        ):
            raise ValueError(
                "Configure CLIPROXYAPI_URL as the provider's base HTTP(S) address."
            )
        if not self.key:
            raise ValueError(
                "Configure CLIPROXYAPI_KEY in the private provider environment."
            )

    def call(
        self,
        path,
        body=None,
        content_type="application/json",
        *,
        timeout=300,
        check_interrupt=None,
    ):
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        headers = {"Authorization": f"Bearer {self.key}"}
        if data is not None:
            headers["Content-Type"] = content_type
        req = request.Request(self.base + path, data=data, headers=headers)

        # Never follow provider redirects with the bearer credential.
        class NoRedirect(request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None

        def send():
            try:
                with request.build_opener(NoRedirect).open(
                    req, timeout=timeout
                ) as response:
                    return json.load(response)
            except error.HTTPError as exc:
                raise RuntimeError(
                    f"CLIProxyAPI returned HTTP {exc.code}; inspect provider health."
                ) from None

        return interruptible(send, check_interrupt)

    def image(
        self,
        prompt,
        size,
        reference=None,
        model="",
        resolution="",
        check_interrupt=None,
    ):
        fields = {
            "model": media_model("image", model),
            "prompt": prompt,
            "response_format": "b64_json",
            "size": size,
        }
        width, height = (int(value) for value in size.split("x"))
        resolution = media_resolution(
            "image", fields["model"], resolution, width, height
        )
        if resolution:
            fields["resolution"] = resolution
        if fields["model"] == "grok-imagine-image-2.0":
            divisor = math.gcd(width, height)
            del fields["size"]
            fields["aspect_ratio"] = f"{width // divisor}:{height // divisor}"
            if reference is not None:
                fields["image"] = {
                    "type": "image_url",
                    "url": "data:image/png;base64,"
                    + base64.b64encode(reference).decode(),
                }
            result = self.call(
                "/v1/images/edits"
                if reference is not None
                else "/v1/images/generations",
                fields,
                check_interrupt=check_interrupt,
            )
        elif reference is None:
            result = self.call(
                "/v1/images/generations", fields, check_interrupt=check_interrupt
            )
        else:
            boundary = uuid.uuid4().hex
            parts = []
            for name, value in fields.items():
                parts.append(
                    f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
                )
            parts.extend(
                [
                    f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n'.encode(),
                    reference,
                    f"\r\n--{boundary}--\r\n".encode(),
                ]
            )
            result = self.call(
                "/v1/images/edits",
                b"".join(parts),
                f"multipart/form-data; boundary={boundary}",
                check_interrupt=check_interrupt,
            )
        item = result["data"][0]
        return (
            base64.b64decode(item["b64_json"], validate=True)
            if item.get("b64_json")
            else download(item["url"], check_interrupt)
        )

    def video(
        self,
        prompt,
        width,
        height,
        seconds,
        reference=None,
        model="",
        resolution="",
        check_interrupt=None,
    ):
        if (
            isinstance(seconds, bool)
            or not isinstance(seconds, int)
            or not 1 <= seconds <= 15
        ):
            raise ValueError("Video duration must be between 1 and 15 seconds.")
        model = media_model("video", model)
        resolution = media_resolution("video", model, resolution, width, height)
        divisor = math.gcd(width, height)
        body = {
            "aspect_ratio": f"{width // divisor}:{height // divisor}",
            "duration": seconds,
            "model": model,
            "prompt": prompt,
        }
        if resolution:
            body["resolution"] = resolution
        if reference is not None:
            body["image"] = {
                "url": "data:image/png;base64," + base64.b64encode(reference).decode()
            }
        submitted = self.call(
            "/v1/videos/generations", body, check_interrupt=check_interrupt
        )
        job = submitted.get("request_id")
        if not isinstance(job, str) or not job:
            raise RuntimeError(
                "CLIProxyAPI returned no video request ID; inspect provider before retrying."
            )
        deadline = time.monotonic() + 900
        while time.monotonic() < deadline:
            if check_interrupt is not None:
                check_interrupt()
            result = self.call(
                "/v1/videos/" + parse.quote(job, safe=""),
                timeout=min(10, max(0.1, deadline - time.monotonic())),
                check_interrupt=check_interrupt,
            )
            if result.get("status") in {"completed", "done"}:
                url = (
                    (result.get("video") or {}).get("url")
                    or result.get("video_url")
                    or result.get("output_url")
                )
                if not url:
                    raise RuntimeError(
                        "CLIProxyAPI completed the video without an output URL."
                    )
                return download(url, check_interrupt)
            if result.get("status") in {"error", "failed"}:
                raise RuntimeError("CLIProxyAPI video failed; inspect provider health.")
            for _ in range(20):
                if check_interrupt is not None:
                    check_interrupt()
                time.sleep(0.1)
        raise TimeoutError(
            "Video still pending after 15 minutes; inspect provider before retrying."
        )


def download(url, check_interrupt=None):
    if parse.urlsplit(url).scheme != "https":
        raise ValueError("Provider media must use an HTTPS download URL.")

    # A separate request deliberately carries no provider credential.
    def read():
        with request.urlopen(url, timeout=300) as response:
            return response.read()

    return interruptible(read, check_interrupt)


class GrokMedia:
    CATEGORY = "CLIProxyAPI"
    FUNCTION = "generate"
    OUTPUT_NODE = True
    RETURN_TYPES = ()

    @classmethod
    def INPUT_TYPES(cls):
        files = sorted(
            name
            for name in os.listdir(folder_paths.get_input_directory())
            if Path(name).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        )
        try:
            models = schema_models()
        except (OSError, RuntimeError, TypeError, ValueError):
            # Provider outages must not prevent ComfyUI from listing other nodes.
            models = {kind: () for kind in MODEL_PREFIXES}
        return {
            "required": {
                "kind": (["image", "video"],),
                "prompt": ("STRING", {"multiline": True}),
                "width": ("INT", {"default": 1024, "min": 256, "max": 2048, "step": 8}),
                "height": (
                    "INT",
                    {"default": 1024, "min": 256, "max": 2048, "step": 8},
                ),
                "seconds": ("INT", {"default": 6, "min": 1, "max": 15}),
            },
            "optional": {
                "count": ("INT", {"default": 1, "min": 1, "max": 8}),
                "image": ([""] + files, {"image_upload": True}),
                "model": ([""] + list(models["image"]) + list(models["video"]),),
                "resolution": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": "Optional provider resolution, such as 1k, 2k or 720p.",
                    },
                ),
            },
            "hidden": {"workflow_prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Provider does not support reproducible seeds; each queued job is new.
        return float("nan")

    def generate(
        self, kind, prompt, width, height, seconds, seed=None, count=1, **kwargs
    ):
        # Accept seeds in saved API workflows; the provider has no seed contract.
        if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= 8:
            raise ValueError("Choose between one and eight image outputs.")
        key = "images" if kind == "image" else "videos"
        outputs = []
        for _ in range(count if kind == "image" else 1):
            check_cancelled()
            result = self._generate_one(kind, prompt, width, height, seconds, **kwargs)
            outputs.extend(result["ui"][key])
        return {"ui": {key: outputs}, "result": ()}

    def _generate_one(
        self,
        kind,
        prompt,
        width,
        height,
        seconds,
        image="",
        workflow_prompt=None,
        extra_pnginfo=None,
        model="",
        resolution="",
    ):
        model = media_model(kind, model)
        resolution = media_resolution(kind, model, resolution, width, height)
        reference = None
        if image:
            reference_path = Path(folder_paths.get_annotated_filepath(image)).resolve()
            input_root = Path(folder_paths.get_input_directory()).resolve()
            if not reference_path.is_relative_to(input_root):
                raise ValueError(
                    "References must belong to this instance's input folder."
                )
            with Image.open(reference_path) as original:
                stream = io.BytesIO()
                original.convert("RGB").save(stream, format="PNG")
                reference = stream.getvalue()
        proxy = Proxy()
        if kind == "image":
            content = proxy.image(
                prompt,
                f"{width}x{height}",
                reference,
                model=model,
                resolution=resolution,
                check_interrupt=check_cancelled,
            )
        elif kind == "video":
            content = proxy.video(
                prompt,
                width,
                height,
                seconds,
                reference,
                model=model,
                resolution=resolution,
                check_interrupt=check_cancelled,
            )
        else:
            raise ValueError("Unsupported media kind.")
        check_cancelled()
        output = Path(folder_paths.get_output_directory()) / "grok"
        output.mkdir(parents=True, exist_ok=True)
        filename = uuid.uuid4().hex + (".png" if kind == "image" else ".mp4")
        destination = output / filename
        metadata = {
            "model": model,
            "prompt": prompt,
            "provider": "cliproxyapi",
            "reference": image,
            "resolution": resolution or None,
            "seconds": seconds if kind == "video" else None,
        }
        if kind == "image":
            pnginfo = PngImagePlugin.PngInfo()
            pnginfo.add_text("prompt", json.dumps(workflow_prompt or {}))
            pnginfo.add_text(
                "parameters",
                f"{prompt}\nSteps: 1, Model: {metadata['model']}, Size: {width}x{height}",
            )
            for key, value in (extra_pnginfo or {}).items():
                pnginfo.add_text(key, json.dumps(value))
            with Image.open(io.BytesIO(content)) as generated:
                generated.save(destination, pnginfo=pnginfo)
        else:
            destination.write_bytes(content)
        destination.with_suffix(destination.suffix + ".json").write_text(
            json.dumps(metadata, indent=2) + "\n"
        )
        return {
            "ui": {
                "images" if kind == "image" else "videos": [
                    {"filename": filename, "subfolder": "grok", "type": "output"}
                ]
            },
            "result": (),
        }


NODE_CLASS_MAPPINGS = {"GrokMedia": GrokMedia}
NODE_DISPLAY_NAME_MAPPINGS = {"GrokMedia": "Grok Image & Video"}
