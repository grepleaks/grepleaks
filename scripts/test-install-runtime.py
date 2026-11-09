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

    def test_detection_shape(self):
        status = install.detect_runtime()
        for key in ("system", "docker", "colima", "orbstack", "rancher", "desktop", "podman"):
            self.assertIn(key, status)


if __name__ == "__main__":
    unittest.main()
