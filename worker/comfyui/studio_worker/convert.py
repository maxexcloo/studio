"""Converts a Krea 2 fine-tune (one DiT .safetensors) to a Radiance image model, one at a time.

Downloads the release's other pipeline parts and the fine-tune with curl, renames the fine-tune's
tensors to diffusers' (the bytes are copied, never decoded), runs rad-convert, installs the .rad
in the Radiance image folder and adds its entry to the folder's fine-tunes.yaml, which the Radiance
deployment merges into its config when it starts. Studio starts it, polls `status` and may `cancel`;
a stopped download resumes on the next start. Provider credentials reach curl only through a header file in the container's temporary folder.
"""

import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
import threading
from pathlib import Path

RADIANCE = Path("/opt/radiance")
BASE = "https://huggingface.co/krea/Krea-2-Turbo/resolve/98e0fe118d17c9e3547fbb2e25acdbae2cadf7c7/"
BASE_FILES = [
    "model_index.json",
    "scheduler/scheduler_config.json",
    "text_encoder/config.json",
    "text_encoder/model.safetensors",
    "tokenizer/chat_template.jinja",
    "tokenizer/tokenizer.json",
    "tokenizer/tokenizer_config.json",
    "transformer/config.json",
    "vae/config.json",
    "vae/diffusion_pytorch_model.safetensors",
]
# A scaled or ComfyUI-quantised file has these; the recipe takes plain weights.
QUANTISED = (".weight_scale", ".comfy_quant", ".scale_weight", ".input_scale")
HOSTS = {"civitai.com": "civitai", "huggingface.co": "hf"}
# Where the Radiance deployment mounts this folder (kubelab apps/base/radiance).
SERVED = "/models/radiance"

# Krea's reference names (krea-ai/krea-2 mmdit.py) to diffusers' Krea2Transformer2DModel names.
RULES = [
    (r"^model\.diffusion_model\.", ""),
    (r"^blocks\.(\d+)\.", r"transformer_blocks.\1."),
    (r"^txtfusion\.", r"text_fusion."),
    (r"\.attn\.wq\.", ".attn.to_q."),
    (r"\.attn\.wk\.", ".attn.to_k."),
    (r"\.attn\.wv\.", ".attn.to_v."),
    (r"\.attn\.wo\.", ".attn.to_out.0."),
    (r"\.attn\.gate\.", ".attn.to_gate."),
    (r"\.attn\.qknorm\.qnorm\.scale$", ".attn.norm_q.weight"),
    (r"\.attn\.qknorm\.knorm\.scale$", ".attn.norm_k.weight"),
    (r"\.mlp\.(gate|up|down)\.", r".ff.\1."),
    (r"\.prenorm\.scale$", ".norm1.weight"),
    (r"\.postnorm\.scale$", ".norm2.weight"),
    (r"\.mod\.lin$", ".scale_shift_table"),
    (r"^first\.", "img_in."),
    (r"^last\.linear\.", "final_layer.linear."),
    (r"^last\.norm\.scale$", "final_layer.norm.weight"),
    (r"^last\.modulation\.lin$", "final_layer.scale_shift_table"),
    (r"^tmlp\.0\.", "time_embed.linear_1."),
    (r"^tmlp\.2\.", "time_embed.linear_2."),
    (r"^tproj\.1\.", "time_mod_proj."),
    (r"^txtmlp\.0\.scale$", "txt_in.norm.weight"),
    (r"^txtmlp\.1\.", "txt_in.linear_1."),
    (r"^txtmlp\.3\.", "txt_in.linear_2."),
]

LOCK = threading.Lock()
# The latest conversion this process ran; Studio clears it once it has added the backend.
JOB = {}


class Stopped(Exception):
    pass


def models_folder():
    return Path(os.environ.get("RADIANCE_IMAGE_MODELS", "/models/radiance-image"))


def rad(tool, *args):
    return [
        str(RADIANCE / "runtime/ld-linux-x86-64.so.2"),
        "--library-path",
        str(RADIANCE / "runtime/lib"),
        str(RADIANCE / "bin" / tool),
        *args,
    ]


def header(file):
    with open(file, "rb") as stream:
        size = struct.unpack("<Q", stream.read(8))[0]
        return size, json.loads(stream.read(size))


def check(file):
    """Refuses anything but a plain fp8 or bf16 Krea 2 DiT."""
    _, tensors = header(file)
    quantised = [key for key in tensors if key.endswith(QUANTISED)]
    dtypes = {value["dtype"] for key, value in tensors.items() if key != "__metadata__"}
    if quantised:
        raise ValueError(
            "The fine-tune is scaled or quantised; choose its plain fp8 or bf16 file."
        )
    if not dtypes <= {"F8_E4M3", "BF16", "F16", "F32"}:
        raise ValueError(f"The fine-tune holds unsupported weights: {sorted(dtypes)}.")


def serve(folder, name):
    """Adds the model's entry to fine-tunes.yaml, indented to sit under the config's `models:`."""
    fragment = folder / "fine-tunes.yaml"
    text = fragment.read_text() if fragment.is_file() else ""
    if re.search(rf"^  {re.escape(name)}:$", text, re.MULTILINE):
        return
    partial = Path(str(fragment) + ".part")
    partial.write_text(f"{text}  {name}:\n    model: {SERVED}/{name}.rad\n    tp: 1\n")
    partial.chmod(0o644)
    os.replace(partial, fragment)


def to_diffusers(key):
    for pattern, replacement in RULES:
        key = re.sub(pattern, replacement, key)
    return key


def mapped_header(source):
    """Map native names and shapes without reading tensor payloads."""
    size, tensors = header(source)
    metadata = tensors.pop("__metadata__", None)
    mapped = {}
    for key, value in tensors.items():
        native = key.removeprefix("model.diffusion_model.")
        name = to_diffusers(native)
        if name == native or name in mapped:
            raise ValueError(f"'{key}' is not a Krea 2 DiT tensor.")
        value = dict(value)
        if name.endswith(".scale_shift_table") and len(value["shape"]) == 1:
            if value["shape"][0] % 6:
                raise ValueError(f"'{key}' is not six rows of the model width.")
            value["shape"] = [6, value["shape"][0] // 6]
        mapped[name] = value
    if metadata:
        mapped["__metadata__"] = metadata
    return size, mapped


def map_transformer(source, destination, stopped):
    """Writes the fine-tune under diffusers' tensor names; modulation tables become [6, D]."""
    size, mapped = mapped_header(source)
    encoded = json.dumps(mapped, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 8)
    partial = Path(str(destination) + ".part")
    with open(source, "rb") as reader, open(partial, "wb") as writer:
        writer.write(struct.pack("<Q", len(encoded)))
        writer.write(encoded)
        reader.seek(8 + size)
        for chunk in iter(lambda: reader.read(64 << 20), b""):
            if stopped():
                raise Stopped()
            writer.write(chunk)
    os.replace(partial, destination)


def digest(file):
    sha = hashlib.sha256()
    with open(file, "rb") as stream:
        for chunk in iter(lambda: stream.read(8 << 20), b""):
            sha.update(chunk)
    return sha.hexdigest()


def run(command, log, job, progress=None):
    """Runs one step, stopping it when the job is cancelled; its output goes to the job's log."""
    with open(log, "ab") as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT)
    try:
        while True:
            if progress:
                progress()
            try:
                process.wait(timeout=0.5)
                break
            except subprocess.TimeoutExpired:
                pass
            if job["cancel"]:
                process.terminate()
                process.wait()
                raise Stopped()
    finally:
        if process.poll() is None:
            process.kill()
    if process.returncode:
        lines = Path(log).read_text(errors="replace").strip().splitlines()
        raise RuntimeError(lines[-1] if lines else f"{Path(command[0]).name} failed.")


def fetch(url, file, auth, log, job, progress=False):
    """Downloads to `<file>.part`, resuming one a stopped run left, then renames it."""
    if file.is_file():
        return
    file.parent.mkdir(parents=True, exist_ok=True)
    partial = Path(str(file) + ".part")
    if not (
        progress and partial.is_file() and partial.stat().st_size == job["totalBytes"]
    ):
        command = ["curl", "-fsSL", "--retry", "5", "-C", "-", "-o", str(partial)]
        # curl sends a -H header only to the host asked, not to the CDN a provider redirects to.
        if auth:
            command += ["-H", f"@{auth}"]

        def received():
            job["bytes"] = partial.stat().st_size if partial.is_file() else 0

        run([*command, url], log, job, received if progress else None)
    partial.rename(file)


def convert(job, url, sha256, tokens):
    folder = models_folder()
    work = folder / ".convert"
    base = work / "krea-2-turbo"
    source = work / "sources" / f"{sha256}.safetensors"
    pipeline = work / job["name"]
    output = work / f"{job['name']}.rad"
    log = work / f"{job['name']}.log"
    target = folder / f"{job['name']}.rad"
    work.mkdir(parents=True, exist_ok=True)
    log.unlink(missing_ok=True)
    auth = {}
    result = {"status": "done"}
    try:
        for kind, token in tokens.items():
            if token:
                # In the container's own temporary folder, so a killed worker leaves no token on the volume.
                descriptor, file = tempfile.mkstemp(suffix=".header")
                with os.fdopen(descriptor, "w") as stream:
                    stream.write(f"Authorization: Bearer {token}\n")
                auth[kind] = Path(file)
        job["stage"] = "base"
        for name in BASE_FILES:
            fetch(BASE + name, base / name, auth.get("hf"), log, job)
        job["stage"] = "download"
        fetch(url, source, auth.get(HOSTS[url.split("/")[2]]), log, job, progress=True)
        job["bytes"] = source.stat().st_size
        job["stage"] = "verify"
        if digest(source) != sha256:
            source.unlink()
            raise ValueError("The download did not match its published checksum.")
        job["stage"] = "check"
        check(source)
        job["stage"] = "map"
        shutil.rmtree(pipeline, ignore_errors=True)
        (pipeline / "transformer").mkdir(parents=True)
        for part in [
            "model_index.json",
            "scheduler",
            "text_encoder",
            "tokenizer",
            "vae",
        ]:
            (pipeline / part).symlink_to(base / part)
        shutil.copy(base / "transformer/config.json", pipeline / "transformer")
        map_transformer(
            source,
            pipeline / "transformer/diffusion_pytorch_model.safetensors",
            lambda: job["cancel"],
        )
        job["stage"] = "convert"
        home = RADIANCE / "share/radiance"
        options = [
            "--home",
            str(home),
            "--recipe",
            str(home / "recipes/krea-2-iq8r.recipe"),
        ]
        run(rad("rad-convert", str(pipeline), "-o", str(output), *options), log, job)
        run(rad("rad-info", str(output)), log, job)
        job["stage"] = "install"
        output.chmod(0o644)
        # link() refuses an existing model, so a file installed meanwhile survives.
        os.link(output, target)
        serve(folder, job["name"])
        output.unlink()
        source.unlink()
    except Stopped:
        result = {"status": "stopped"}
    except Exception as error:  # noqa: BLE001 -- Reported to Studio through `status`.
        result = {"status": "failed", "error": str(error) or "The conversion failed."}
    finally:
        for file in auth.values():
            file.unlink(missing_ok=True)
        shutil.rmtree(pipeline, ignore_errors=True)
        output.unlink(missing_ok=True)
    # Last, so a new conversion can start only once this one has cleaned up.
    job.update(result)


def start(name, url, size, sha256, tokens, note):
    if not isinstance(name, str) or not re.fullmatch(
        r"[a-z0-9][a-z0-9._-]{0,99}", name
    ):
        raise ValueError(
            "Name the model with lowercase letters, digits, dots and dashes."
        )
    match = (
        re.fullmatch(r"https://([^/@:]+)/\S+", url) if isinstance(url, str) else None
    )
    if not match or match[1] not in HOSTS:
        raise ValueError("Only Civitai and Hugging Face downloads are supported.")
    if not isinstance(sha256, str) or not re.fullmatch("[a-f0-9]{64}", sha256):
        raise ValueError("A published SHA-256 checksum is required.")
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
        raise ValueError("The fine-tune's size is required.")
    if (models_folder() / f"{name}.rad").exists():
        raise ValueError(f"A Radiance model named {name}.rad already exists.")
    with LOCK:
        if JOB.get("status") == "running":
            raise ValueError("A conversion is already running.")
        JOB.clear()
        JOB.update(
            name=name,
            note={key: str(value)[:200] for key, value in note.items()},
            status="running",
            stage="base",
            bytes=0,
            totalBytes=size,
            error="",
            cancel=False,
        )
    threading.Thread(
        target=convert, args=(JOB, url, sha256, tokens), daemon=True
    ).start()
    return status()


def status():
    return {
        "conversion": {key: value for key, value in JOB.items() if key != "cancel"}
        or None
    }


def cancel():
    if JOB.get("status") == "running":
        JOB["cancel"] = True
    return status()


def clear(name):
    with LOCK:
        if JOB.get("name") == name and JOB.get("status") != "running":
            JOB.clear()
    return status()


def main():
    """Stage a native checkpoint for the supported converter, or inspect headers only."""
    import argparse

    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()
    check(args.source)
    _, mapped = mapped_header(args.source)
    tensors = {name: value for name, value in mapped.items() if name != "__metadata__"}
    if args.reference:
        _, reference = header(args.reference)
        reference.pop("__metadata__", None)
        if set(tensors) != set(reference) or any(
            any(value[field] != reference[name][field] for field in ("dtype", "shape"))
            for name, value in tensors.items()
        ):
            raise ValueError(
                "Mapped tensor names, shapes or dtypes differ from the reference pipeline."
            )
    if not args.plan:
        if args.destination.exists():
            raise FileExistsError(args.destination)
        map_transformer(args.source, args.destination, lambda: False)
    print(
        json.dumps(
            {
                "planned": args.plan,
                "tensors": len(tensors),
                "referenceMatched": bool(args.reference),
            }
        )
    )


if __name__ == "__main__":
    main()
