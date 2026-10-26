import asyncio
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from models import (
    MAX_BYTES,
    digest,
    discard,
    inventory,
    preserve_replaced,
    receive,
    remove,
    state,
    target,
)


async def chunks(*items):
    for item in items:
        yield item


class WorkerModelTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "loras").mkdir()
        self.file = self.root / "loras/model.safetensors"
        self.sha = hashlib.sha256(b"abcdef").hexdigest()

    def receive(self, data, offset=0, size=6, sha=None, identity="model"):
        return asyncio.run(
            receive(
                self.root,
                "loras",
                self.file.name,
                offset,
                size,
                self.sha if sha is None else sha,
                {
                    "source": hashlib.sha256(identity.encode()).hexdigest(),
                    "id": identity,
                    "label": "Model",
                    "authorization": "never-store-this",
                },
                chunks(*data),
            )
        )

    def test_atomic_publish_and_independent_checksum_verification(self):
        result = self.receive([b"abc", b"def"])
        self.assertEqual(result["size"], 6)
        self.assertEqual(self.file.read_bytes(), b"abcdef")
        self.assertEqual(digest(self.file), self.sha)
        self.assertFalse(Path(str(self.file) + ".part").exists())
        self.assertEqual(
            state(self.root, "loras", self.file.name, True)["sha256"], self.sha
        )

    def test_bad_checksum_is_never_published(self):
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.receive([b"broken"])
        self.assertFalse(self.file.exists())
        self.assertFalse(Path(str(self.file) + ".part").exists())

    def test_short_transfer_is_preserved_and_resumed(self):
        with self.assertRaisesRegex(ValueError, "incomplete"):
            self.receive([b"abc"])
        self.assertFalse(self.file.exists())
        note = json.loads(Path(str(self.file) + ".part.json").read_text())
        self.assertNotIn("authorization", note)
        self.assertEqual(state(self.root, "loras", self.file.name)["partialBytes"], 3)
        self.assertEqual(inventory(self.root)["paused"][0]["receivedBytes"], 3)
        self.receive([b"def"], offset=3)
        self.assertEqual(self.file.read_bytes(), b"abcdef")

    def test_resume_refuses_a_different_identity_or_checksum(self):
        with self.assertRaises(ValueError):
            self.receive([b"abc"])
        for args in [{"identity": "different"}, {"sha": "b" * 64}, {"size": 7}]:
            with self.assertRaisesRegex(ValueError, "source changed"):
                self.receive([b"def"], offset=3, **args)
        self.assertEqual(Path(str(self.file) + ".part").read_bytes(), b"abc")

    def test_extra_bytes_never_publish_or_overrun_the_declared_size(self):
        with self.assertRaisesRegex(ValueError, "exceeds"):
            self.receive([b"abc", b"defgh"])
        self.assertFalse(self.file.exists())
        self.assertEqual(Path(str(self.file) + ".part").read_bytes(), b"abc")

    def test_traversal_and_symlinks_cannot_access_outside_library(self):
        for folder, name in [
            ("other", "x.safetensors"),
            ("loras", "../x.safetensors"),
            ("loras", "/tmp/x.safetensors"),
            ("loras", "x\\y.safetensors"),
        ]:
            with self.assertRaises(ValueError):
                target(self.root, folder, name)
        outside = self.root / "outside.safetensors"
        outside.write_bytes(b"keep")
        self.file.symlink_to(outside)
        with self.assertRaises(ValueError):
            self.receive([b"abcdef"])
        self.assertEqual(outside.read_bytes(), b"keep")

    def test_nested_reads_confine_parents_and_inventory_excludes_symlinks(self):
        nested = self.root / "loras/nested"
        nested.mkdir()
        (nested / "real.safetensors").write_bytes(b"real")
        self.assertEqual(
            state(self.root, "loras", "nested/real.safetensors")["size"], 4
        )
        nested.rename(self.root / "outside")
        nested.symlink_to(self.root / "outside", target_is_directory=True)
        with self.assertRaises(ValueError):
            state(self.root, "loras", "nested/real.safetensors")
        self.assertEqual(inventory(self.root)["files"], [])

    def test_existing_files_need_explicit_replacement_and_old_bytes_survive(self):
        self.file.write_bytes(b"original")
        with self.assertRaisesRegex(ValueError, "already uses"):
            self.receive([b"abcdef"])
        preserve_replaced(self.root, "loras", self.file.name, self.sha)
        backups = list(self.file.parent.glob("model.safetensors.previous.*"))
        self.assertEqual(backups[0].read_bytes(), b"original")
        self.receive([b"abcdef"])
        discard(self.root, "loras", self.file.name)
        self.assertEqual(self.file.read_bytes(), b"abcdef")
        self.assertEqual(backups[0].read_bytes(), b"original")

    def test_remove_needs_the_recorded_checksum(self):
        self.file.write_bytes(b"abcdef")
        with self.assertRaisesRegex(ValueError, "checksum"):
            remove(self.root, "loras", self.file.name, "")
        with self.assertRaisesRegex(ValueError, "changed"):
            remove(self.root, "loras", self.file.name, "f" * 64)
        self.assertTrue(self.file.exists())
        self.assertTrue(remove(self.root, "loras", self.file.name, self.sha))
        self.assertFalse(self.file.exists())
        self.assertFalse(remove(self.root, "loras", self.file.name, self.sha))

    def test_malformed_notes_do_not_break_inventory(self):
        Path(str(self.file) + ".part").write_bytes(b"abc")
        note = Path(str(self.file) + ".part.json")
        for value in ["[]", '{"totalBytes":"invalid"}', "broken-json"]:
            note.write_text(value)
            found = inventory(self.root)["paused"]
            self.assertEqual(found[0]["receivedBytes"], 3)
            self.assertEqual(found[0]["totalBytes"], 0)

    def test_completed_same_checksum_is_idempotent(self):
        self.file.write_bytes(b"abcdef")
        self.assertTrue(self.receive([])["already"])

    def test_concurrent_destination_is_never_overwritten(self):
        async def concurrent_content():
            yield b"abc"
            self.file.write_bytes(b"preserve external arrival")
            yield b"def"

        with self.assertRaises(FileExistsError):
            asyncio.run(
                receive(
                    self.root,
                    "loras",
                    self.file.name,
                    0,
                    6,
                    self.sha,
                    {"source": "a" * 64},
                    concurrent_content(),
                )
            )
        self.assertEqual(self.file.read_bytes(), b"preserve external arrival")

    def test_size_bounds_and_missing_checksums_are_rejected(self):
        for args in [{"size": MAX_BYTES + 1}, {"sha": ""}, {"size": 0}]:
            with self.assertRaises(ValueError):
                self.receive([], **args)
        self.assertFalse(self.file.exists())

    def test_configured_aliases_and_secondary_roots_are_listed_and_confined(self):
        first = self.root / "clip"
        second = self.root / "extra"
        first.mkdir()
        second.mkdir()
        (second / "encoder.gguf").write_bytes(b"encoder")
        roots = {"text_encoders": [first, second]}
        self.assertEqual(
            inventory(roots)["files"][0]["path"], "text_encoders/encoder.gguf"
        )
        self.assertEqual(state(roots, "text_encoders", "encoder.gguf")["size"], 7)
        self.assertEqual(
            target(roots, "text_encoders", "new.gguf"), first.resolve() / "new.gguf"
        )
