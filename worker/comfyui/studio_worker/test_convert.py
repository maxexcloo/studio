"""Krea 2 fine-tune conversion with fixture weights, a stand-in curl and stand-in Radiance tools."""

import hashlib
import json
import os
import stat
import struct
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from studio_worker import convert

CURL = r"""#!/usr/bin/env python3
import json, os, shutil, sys, time
args = sys.argv[1:]
output = args[args.index("-o") + 1]
header = args[args.index("-H") + 1] if "-H" in args else ""
with open(os.environ["CURL_LOG"], "a") as log:
    log.write(json.dumps({"argv": args, "header": open(header[1:]).read() if header else ""}) + "\n")
url = args[-1]
if url.startswith("https://civitai.com/"):
    if os.environ.get("CURL_SLEEP"):
        open(output, "wb").write(b"partial")
        time.sleep(30)
    shutil.copy(os.environ["FIXTURE"], output)
else:
    open(output, "w").write("{}")
"""

RAD = r"""#!/usr/bin/env python3
import sys
tool, args = sys.argv[1], sys.argv[2:]
if tool == "rad-convert":
    open(args[args.index("-o") + 1], "wb").write(b"rad")
print(tool, "ok")
"""


def safetensors(file, tensors, data=b""):
    encoded = json.dumps(tensors).encode()
    Path(file).write_bytes(struct.pack("<Q", len(encoded)) + encoded + data)


def native(file, dtype="F8_E4M3"):
    safetensors(
        file,
        {
            "blocks.0.attn.wq.weight": {
                "dtype": dtype,
                "shape": [2, 2],
                "data_offsets": [0, 4],
            },
            "blocks.0.mod.lin": {
                "dtype": dtype,
                "shape": [12],
                "data_offsets": [4, 16],
            },
        },
        bytes(range(16)),
    )


class RecipeTests(unittest.TestCase):
    def test_recipe_follows_the_weights(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "model.safetensors"
            native(file)
            self.assertEqual(convert.recipe(file), "krea-2-fp8-unscaled.recipe")
            native(file, "BF16")
            self.assertEqual(convert.recipe(file), "krea-2-fp8.recipe")
            safetensors(
                file, {"blocks.0.attn.wq.weight_scale": {"dtype": "F32", "shape": [1]}}
            )
            with self.assertRaisesRegex(ValueError, "scaled or quantised"):
                convert.recipe(file)

    def test_mapping_renames_tensors_and_keeps_their_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / "in", Path(directory) / "out"
            native(source)
            convert.map_transformer(source, target, lambda: False)
            _, tensors = convert.header(target)
            self.assertEqual(
                tensors["transformer_blocks.0.attn.to_q.weight"]["shape"], [2, 2]
            )
            self.assertEqual(
                tensors["transformer_blocks.0.scale_shift_table"]["shape"], [6, 2]
            )
            self.assertTrue(target.read_bytes().endswith(bytes(range(16))))
            safetensors(source, {"unknown.weight": {"dtype": "BF16", "shape": [1]}})
            with self.assertRaisesRegex(ValueError, "not a Krea 2 DiT tensor"):
                convert.map_transformer(source, target, lambda: False)


class ConversionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.models = root / "radiance"
        self.models.mkdir()
        tools = root / "bin"
        tools.mkdir()
        for name, text in [("curl", CURL), ("rad", RAD)]:
            (tools / name).write_text(text)
            (tools / name).chmod(stat.S_IRWXU)
        self.fixture = root / "fixture.safetensors"
        native(self.fixture)
        self.log = root / "curl.log"
        environment = {
            "CURL_LOG": str(self.log),
            "FIXTURE": str(self.fixture),
            "PATH": f"{tools}{os.pathsep}{os.environ['PATH']}",
            "RADIANCE_IMAGE_MODELS": str(self.models),
        }
        for patcher in [
            patch.dict(os.environ, environment),
            patch.object(
                convert,
                "rad",
                lambda tool, *args: [sys.executable, str(tools / "rad"), tool, *args],
            ),
        ]:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(self.directory.cleanup)
        convert.JOB.clear()

    def start(self, sha256=None):
        data = self.fixture.read_bytes()
        return convert.start(
            "fine-tune-fp8",
            "https://civitai.com/api/download/models/1?fileId=2",
            len(data),
            sha256 or hashlib.sha256(data).hexdigest(),
            {"civitai": "civitai-test-token", "hf": "hf-test-token"},
            {"profile": "image-fine-tune"},
        )

    def finish(self):
        for _ in range(200):
            if convert.JOB["status"] != "running":
                return convert.status()["conversion"]
            time.sleep(0.05)
        self.fail("The conversion did not finish.")

    def test_conversion_installs_the_model_and_keeps_tokens_out_of_argv(self):
        self.start()
        conversion = self.finish()
        self.assertEqual(conversion["status"], "done", conversion)
        self.assertEqual(conversion["note"], {"profile": "image-fine-tune"})
        self.assertEqual((self.models / "fine-tune-fp8.rad").read_bytes(), b"rad")
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual(len(calls), len(convert.BASE_FILES) + 1)
        self.assertTrue(
            all("test-token" not in " ".join(call["argv"]) for call in calls)
        )
        self.assertEqual(
            calls[-1]["header"], "Authorization: Bearer civitai-test-token\n"
        )
        self.assertEqual(calls[0]["header"], "Authorization: Bearer hf-test-token\n")
        work = self.models / ".convert"
        self.assertEqual(
            sorted(path.name for path in work.iterdir()),
            ["fine-tune-fp8.log", "krea-2-turbo", "sources"],
        )
        self.assertEqual(list((work / "sources").iterdir()), [])
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.start()
        convert.clear("fine-tune-fp8")
        self.assertIsNone(convert.status()["conversion"])

    def test_a_mismatched_download_fails_and_is_removed(self):
        self.start("0" * 64)
        conversion = self.finish()
        self.assertEqual(conversion["status"], "failed")
        self.assertIn("checksum", conversion["error"])
        self.assertEqual(list((self.models / ".convert/sources").iterdir()), [])
        self.assertFalse((self.models / "fine-tune-fp8.rad").exists())

    def test_cancel_stops_the_download_and_keeps_its_partial(self):
        with patch.dict(os.environ, {"CURL_SLEEP": "1"}):
            self.start()
            for _ in range(200):
                if list((self.models / ".convert/sources").glob("*.part")):
                    break
                time.sleep(0.05)
            with self.assertRaisesRegex(ValueError, "already running"):
                self.start()
            convert.cancel()
            conversion = self.finish()
        self.assertEqual(conversion["status"], "stopped")
        self.assertEqual(
            len(list((self.models / ".convert/sources").glob("*.part"))), 1
        )
        self.assertEqual(list((self.models / ".convert").glob(".*.header")), [])


if __name__ == "__main__":
    unittest.main()
