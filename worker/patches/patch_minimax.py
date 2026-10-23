"""Fit whole MiniMax reference images without stretching or cropping them."""

import hashlib
import sys
from pathlib import Path

UPSTREAM_SHA256 = "108ceff11e5a5c9a34a57bbc380447cf9941beb673a1bd421abc818de54ccd5c"
BEFORE = """def _resize(image, width, height, crop):
    # image [B, H, W, C] -> [B, height, width, 3]
    samples = image[..., :3].movedim(-1, 1)
    samples = comfy.utils.common_upscale(samples, width, height, "lanczos", crop)
    return samples.movedim(1, -1)"""
AFTER = """def _resize(image, width, height, crop):
    # Fit the whole reference; canvas alignment must not distort or crop it.
    samples = image[..., :3].movedim(-1, 1)
    source_height, source_width = samples.shape[-2:]
    scale = min(width / source_width, height / source_height)
    fitted_width = max(1, min(width, round(source_width * scale)))
    fitted_height = max(1, min(height, round(source_height * scale)))
    samples = comfy.utils.common_upscale(samples, fitted_width, fitted_height, "lanczos", "disabled")
    left = (width - fitted_width) // 2
    top = (height - fitted_height) // 2
    samples = F.pad(samples, (left, width - fitted_width - left,
                              top, height - fitted_height - top), value=0.0)
    return samples.movedim(1, -1)"""
REPLACEMENTS = (
    (BEFORE, AFTER),
    (
        "# geometry anchor: plain stretch to canvas",
        "# Fit the first frame to the canvas without discarding its edges.",
    ),
    (
        "# follower: aspect-preserving cover-crop",
        "# Fit the final frame with the same geometry policy.",
    ),
)


def patch(root):
    target = Path(root) / "comfy_extras/nodes_minimax_h3.py"
    source = target.read_bytes()
    if hashlib.sha256(source).hexdigest() != UPSTREAM_SHA256:
        raise RuntimeError(
            "MiniMax geometry patch target changed; review the upstream node before building"
        )
    for before, after in REPLACEMENTS:
        if before.encode() not in source:
            raise RuntimeError(f"MiniMax geometry patch target missing: {before!r}")
        source = source.replace(before.encode(), after.encode(), 1)
    target.write_bytes(source)


if __name__ == "__main__":
    patch(sys.argv[1])
