"""Fetch the pinned ComfyUI sources and install their requirements while building the worker image.

The two steps run in separate image layers, so a source pin bump reinstalls packages only when it
changes a requirements file.
"""

import importlib.metadata
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def fetch(core_source, source, target, requirements):
    target = Path(target)
    core = json.loads(Path(core_source).read_text())
    subprocess.run(
        [
            "git",
            "clone",
            "--no-checkout",
            "--filter=blob:none",
            f"https://github.com/{core['repository']}.git",
            str(target),
        ],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(target), "fetch", "--depth", "1", "origin", core["revision"]],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(target), "checkout", "--detach", core["revision"]],
        check=True,
    )
    shutil.rmtree(target / ".git")
    shutil.rmtree(target / "custom_nodes")
    sources = json.loads(Path(source).read_text())
    for item in sources:
        destination = target / item["path"]
        subprocess.run(
            [
                "git",
                "clone",
                "--no-checkout",
                "--filter=blob:none",
                item["url"],
                str(destination),
            ],
            check=True,
        )
        subprocess.run(
            [
                "git",
                "-C",
                str(destination),
                "fetch",
                "--depth",
                "1",
                "origin",
                item["revision"],
            ],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(destination), "checkout", "--detach", item["revision"]],
            check=True,
        )
        shutil.rmtree(destination / ".git")
    # Only the requirements files reach the install layer; none of them refers to another file.
    for path in [
        target / "requirements.txt",
        *(target / "custom_nodes").glob("*/requirements.txt"),
    ]:
        copy = Path(requirements) / path.relative_to(target)
        copy.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, copy)


def install(requirements):
    requirements = Path(requirements)
    # Core and extension dependencies must retain the image's ROCm PyTorch installation.
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt") as constraints:
        for name in ["torch", "torchaudio", "torchvision"]:
            constraints.write(f"{name}=={importlib.metadata.version(name)}\n")
        constraints.flush()
        paths = [
            requirements / "requirements.txt",
            *sorted((requirements / "custom_nodes").glob("*/requirements.txt")),
        ]
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--no-cache-dir",
                "--constraint",
                constraints.name,
                *[
                    argument
                    for path in paths
                    for argument in ("--requirement", str(path))
                ],
            ],
            check=True,
        )


if __name__ == "__main__":
    {"fetch": fetch, "install": install}[sys.argv[1]](*sys.argv[2:])
