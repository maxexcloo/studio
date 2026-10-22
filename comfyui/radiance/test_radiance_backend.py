import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from radiance.backend import Worker, available_models, command


class BackendTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.models = Path(folder.name)
        (self.models / "allowed.rad").touch()
        (self.models / "other.rad").touch()
        self.worker = Worker()
        environment = patch.dict("os.environ", RADIANCE_IMAGE_MODELS=str(self.models))
        environment.start()
        self.addCleanup(environment.stop)

    def test_only_mounted_image_models_are_available(self):
        (self.models / "directory.rad").mkdir()
        self.assertEqual(list(available_models()), ["allowed.rad", "other.rad"])
        for name in ["../outside.rad", "unmounted.rad"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                command(name)
        args = command("allowed.rad")
        self.assertEqual(args[args.index("--host") + 1], "127.0.0.1")
        self.assertNotIn("--api-key", args)

    def test_worker_retains_success_and_exits_on_generation_failure(self):
        for failure in [False, True]:
            process = Mock()
            process.stderr = ()
            process.poll.return_value = None
            response = Mock()
            response.__enter__ = Mock(return_value=Mock(status=200))
            response.__exit__ = Mock(return_value=False)
            with (
                self.subTest(failure=failure),
                patch.dict(
                    "os.environ",
                    HSA_OVERRIDE_GFX_VERSION="12.0.1",
                    HIP_VISIBLE_DEVICES="1",
                ),
                patch(
                    "radiance.backend.subprocess.Popen",
                    return_value=process,
                ) as spawn,
                patch(
                    "radiance.backend.urllib.request.urlopen",
                    return_value=response,
                ),
            ):
                if failure:
                    with (
                        self.assertRaisesRegex(RuntimeError, "generation"),
                        self.worker.use("allowed.rad", lambda: None),
                    ):
                        raise RuntimeError("generation failed")
                else:
                    with self.worker.use("allowed.rad", lambda: None):
                        pass
                if failure:
                    process.terminate.assert_called_once()
                    process.wait.assert_called_once_with(timeout=20)
                else:
                    process.terminate.assert_not_called()
                    with self.worker.use("allowed.rad", lambda: None):
                        pass
                    spawn.assert_called_once()
                    self.worker.stop()
                    process.terminate.assert_called_once()
                self.assertNotIn(
                    "HSA_OVERRIDE_GFX_VERSION", spawn.call_args.kwargs["env"]
                )
                self.assertEqual(
                    spawn.call_args.kwargs["env"]["HIP_VISIBLE_DEVICES"], "1"
                )

    def test_cancellation_during_loading_kills_a_worker_that_wont_exit(self):
        process = Mock()
        process.stderr = ()
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired("radiance", 20), 0]
        with (
            patch(
                "radiance.backend.subprocess.Popen",
                return_value=process,
            ),
            self.assertRaisesRegex(RuntimeError, "cancelled"),
            self.worker.use(
                "allowed.rad", Mock(side_effect=[None, RuntimeError("cancelled")])
            ),
        ):
            self.fail("Cancelled startup must not generate.")
        process.terminate.assert_called_once()
        process.kill.assert_called_once()
        self.assertEqual(process.wait.call_count, 2)

    def test_startup_failure_prevents_generation(self):
        process = Mock()
        process.stderr = ()
        process.poll.return_value = 7
        with (
            patch(
                "radiance.backend.subprocess.Popen",
                return_value=process,
            ),
            self.assertRaisesRegex(RuntimeError, "loading"),
            self.worker.use("allowed.rad", lambda: None),
        ):
            self.fail("Failed startup must not generate.")
        process.terminate.assert_not_called()
        process.wait.assert_called_once_with(timeout=20)

    def test_checkpoint_change_releases_previous_worker_before_preparing(self):
        first, second = Mock(), Mock()
        first.stderr = second.stderr = ()
        first.poll.return_value = second.poll.return_value = None
        response = Mock()
        response.__enter__ = Mock(return_value=Mock(status=200))
        response.__exit__ = Mock(return_value=False)
        with (
            patch(
                "radiance.backend.subprocess.Popen",
                side_effect=[first, second],
            ),
            patch(
                "radiance.backend.urllib.request.urlopen",
                return_value=response,
            ),
        ):
            with self.worker.use("allowed.rad", lambda: None):
                pass

            def prepare():
                first.wait.assert_called_once_with(timeout=20)
                self.assertIsNone(self.worker.process)

            with self.worker.use("other.rad", lambda: None, prepare):
                pass
            self.assertEqual(self.worker.model, "other.rad")
            self.worker.stop()
        second.terminate.assert_called_once()

    def test_cancel_before_reuse_releases_retained_worker(self):
        process = Mock()
        process.stderr = ()
        process.poll.return_value = None
        self.worker.process = process
        self.worker.model = "allowed.rad"
        with (
            self.assertRaisesRegex(RuntimeError, "cancelled"),
            self.worker.use("allowed.rad", Mock(side_effect=RuntimeError("cancelled"))),
        ):
            self.fail("Cancelled jobs must not generate.")
        process.terminate.assert_called_once()
        self.assertIsNone(self.worker.process)

    def test_dead_worker_is_reaped_and_replaced(self):
        old, new = Mock(), Mock()
        old.stderr = new.stderr = ()
        old.poll.return_value = 1
        new.poll.return_value = None
        self.worker.process, self.worker.model = old, "allowed.rad"
        with (
            patch("radiance.backend.subprocess.Popen", return_value=new),
            patch.object(self.worker, "ready"),
            self.worker.use("allowed.rad", lambda: None),
        ):
            pass
        old.wait.assert_called_once_with(timeout=20)
        self.assertIs(self.worker.process, new)
        self.worker.stop()
