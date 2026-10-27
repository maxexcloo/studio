import os
import tempfile
import unittest

from files import delete_files, resolve_target, token_matches


class WorkerFileTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.bases = {
            name: os.path.join(self.root, name) for name in ("output", "input", "temp")
        }
        for base in self.bases.values():
            os.makedirs(os.path.join(base, "studio", "accounts", "abc"))
        self.outside = os.path.join(self.root, "secret.png")
        open(self.outside, "w").close()

    def touch(self, *parts):
        path = os.path.join(*parts)
        open(path, "w").close()
        return path

    def test_deletes_named_media_files_once(self):
        target = self.touch(
            self.bases["output"], "studio", "accounts", "abc", "image_00001_.png"
        )
        staged = self.touch(self.bases["input"], "ref.webp")
        result = delete_files(
            self.bases,
            [
                {
                    "type": "output",
                    "subfolder": "studio/accounts/abc",
                    "filename": "image_00001_.png",
                },
                {"type": "input", "filename": "ref.webp"},
                {
                    "type": "output",
                    "subfolder": "studio/accounts/abc",
                    "filename": "image_00001_.png",
                },
            ],
        )
        self.assertEqual(result, {"deleted": 2, "missing": 1, "refused": 0})
        self.assertFalse(os.path.exists(target) or os.path.exists(staged))

    def test_refuses_traversal_dot_folders_symlinks_and_non_media(self):
        self.touch(self.bases["output"], "notes.txt")
        os.makedirs(os.path.join(self.bases["output"], ".studio-trash"))
        self.touch(self.bases["output"], ".studio-trash", "kept.png")
        os.symlink(self.outside, os.path.join(self.bases["output"], "link.png"))
        for entry in [
            {"filename": "../secret.png"},
            {"subfolder": "..", "filename": "secret.png"},
            {"subfolder": "/etc", "filename": "passwd.png"},
            {"subfolder": ".studio-trash", "filename": "kept.png"},
            {"filename": "notes.txt"},
            {"type": "models", "filename": "x.png"},
            {"filename": ""},
            "nonsense",
        ]:
            self.assertIsNone(resolve_target(self.bases, entry), entry)
        self.assertEqual(
            delete_files(self.bases, [{"filename": "link.png"}])["deleted"], 0
        )
        self.assertTrue(os.path.exists(self.outside))
        inside = self.touch(self.bases["output"], "kept.png")
        os.symlink(inside, os.path.join(self.bases["output"], "inner-link.png"))
        self.assertEqual(
            delete_files(self.bases, [{"filename": "inner-link.png"}])["refused"], 1
        )
        self.assertTrue(os.path.exists(inside))

    def test_tokens_and_limits(self):
        self.assertTrue(token_matches("", None))
        self.assertTrue(token_matches("secret", "secret"))
        self.assertFalse(token_matches("secret", "guess"))
        self.assertFalse(token_matches("secret", None))
        with self.assertRaises(ValueError):
            delete_files(self.bases, [{"filename": "a.png"}] * 257)


if __name__ == "__main__":
    unittest.main()
