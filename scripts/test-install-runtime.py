#!/usr/bin/env python3
"""Focused tests for the installer's container-runtime detection and prompts."""
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout, redirect_stderr

SOURCE = Path(__file__).with_name("install.py")
spec = importlib.util.spec_from_file_location("grepleaks_install", SOURCE)
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)

STATUS = {
    "system": "Darwin",
    "docker": False,
    "colima": False,
    "orbstack": False,
    "rancher": False,
    "desktop": False,
    "podman": False,
}


class FakeStdin:
    def __init__(self, tty):
        self.tty = tty

    def isatty(self):
        return self.tty


class RuntimeTests(unittest.TestCase):
    def test_ready_runtime_short_circuits(self):
        with (
            patch.object(install, "docker_works", return_value=True),
            patch.object(install, "docker_storage_problem", return_value=None),
        ):
            self.assertTrue(install.ensure_runtime(False, True))

    def test_starts_an_installed_runtime(self):
        with (
            patch.object(install, "docker_works", side_effect=[False, False, True]),
            patch.object(install, "docker_storage_problem", return_value=None),
            patch.object(install, "detect_runtime", return_value={**STATUS, "docker": True}),
            patch.object(install, "start_runtime", return_value=True) as start,
        ):
            self.assertTrue(install.ensure_runtime(False, True))
            start.assert_called_once()

    def test_declined_install_returns_false(self):
        with (
            patch.object(install, "docker_works", return_value=False),
            patch.object(install, "detect_runtime", return_value=STATUS),
            patch.object(install, "runtime_plan", return_value="fake plan"),
            patch.object(install.sys, "stdin", FakeStdin(True)),
            patch("builtins.input", return_value="n"),
            redirect_stdout(io.StringIO()),
            redirect_stderr(io.StringIO()),
        ):
            self.assertFalse(install.ensure_runtime(False, True))

    def test_accepted_install_on_macos(self):
        with (
            patch.object(install, "docker_works", side_effect=[False, False, True]),
            patch.object(install, "docker_storage_problem", return_value=None),
            patch.object(install, "detect_runtime", return_value=STATUS),
            patch.object(install, "runtime_plan", return_value="fake plan"),
            patch.object(install.sys, "stdin", FakeStdin(True)),
            patch("builtins.input", return_value="y"),
            patch.object(install, "install_macos", return_value=True) as installer,
        ):
            self.assertTrue(install.ensure_runtime(False, True))
            installer.assert_called_once()

    def test_non_interactive_missing_runtime_returns_false(self):
        with (
            patch.object(install, "docker_works", return_value=False),
            patch.object(install, "detect_runtime", return_value=STATUS),
            patch.object(install, "runtime_plan", return_value="fake plan"),
            patch.object(install.sys, "stdin", FakeStdin(False)),
            redirect_stdout(io.StringIO()),
            redirect_stderr(io.StringIO()),
        ):
            self.assertFalse(install.ensure_runtime(False, True))

    def test_no_install_flag_returns_false(self):
        with (
            patch.object(install, "docker_works", return_value=False),
            patch.object(install, "detect_runtime", return_value=STATUS),
            redirect_stdout(io.StringIO()),
            redirect_stderr(io.StringIO()),
        ):
            self.assertFalse(install.ensure_runtime(False, False))

    def test_storage_failure_stops_install(self):
        with (
            patch.object(install, "docker_works", return_value=True),
            patch.object(install, "docker_storage_problem", return_value="input/output error in containerd"),
            patch.object(install, "install_macos") as installer,
            redirect_stdout(io.StringIO()),
            redirect_stderr(io.StringIO()) as errors,
        ):
            self.assertFalse(install.ensure_runtime(True, True))
            installer.assert_not_called()
            self.assertIn("image store is failing", errors.getvalue())

    def test_runtime_ships_license_notice(self):
        self.assertIn("LICENSES/0-MIT.txt", install.RUNTIME)

    # install() edits the user's PATH in the Windows registry, and faking
    # os.name breaks pathlib there: run this end-to-end case on POSIX only.
    @unittest.skipIf(install.os.name == "nt", "install() writes the Windows registry")
    def test_install_prunes_old_runtimes_but_keeps_previous(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            home, source = Path(tmp) / "home", Path(tmp) / "source"
            for name in install.RUNTIME:
                (source / name).parent.mkdir(parents=True, exist_ok=True)
                (source / name).write_text("x")
            base = home / ".local/share/grepleaks"
            stale = []
            for name in ("runtime-old1", "runtime-old2", "runtime-current"):
                (base / name / "scripts").mkdir(parents=True)
                (base / name / "scripts" / "launch.py").write_text("x")
                stale.append(base / name)
            unrelated = base / "runtime-notes"  # no launcher inside: not ours to delete
            unrelated.mkdir()
            wrapper = home / ".local/bin/grepleaks"
            wrapper.parent.mkdir(parents=True)
            wrapper.write_text(f"#!/bin/sh\n{install.MARKER}\nexec python3 {base}/runtime-current/scripts/launch.py \"$@\"\n")
            with patch.dict(install.os.environ, {"SHELL": "/bin/sh"}):
                install.install(source, home)
            remaining = sorted(p.name for p in base.glob("runtime-*"))
            new = install.RUNTIME_NAME.search(wrapper.read_text()).group(0)
            self.assertNotIn(new, ("runtime-old1", "runtime-old2", "runtime-current"))
            self.assertEqual(remaining, sorted(["runtime-current", "runtime-notes", new]))

    def test_prune_runtimes_keeps_listed_and_foreign_directories(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            for name in ("runtime-old", "runtime-keep", "runtime-new"):
                (base / name / "scripts").mkdir(parents=True)
                (base / name / "scripts" / "launch.py").write_text("x")
            (base / "runtime-foreign").mkdir()
            removed = install.prune_runtimes(base, {base / "runtime-keep", base / "runtime-new", None})
            self.assertEqual(removed, 1)
            self.assertEqual(sorted(p.name for p in base.glob("runtime-*")), ["runtime-foreign", "runtime-keep", "runtime-new"])

    def test_detection_shape(self):
        status = install.detect_runtime()
        for key in ("system", "docker", "colima", "orbstack", "rancher", "desktop", "podman"):
            self.assertIn(key, status)


if __name__ == "__main__":
    unittest.main()
