import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("installer", ROOT / "scripts/install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class ArchiveTests(unittest.TestCase):
    def test_escape_paths_and_links_rejected(self):
        for name, link in [("../escaped", None), ("/escaped", None), ("repo/link", "../../escaped")]:
            with self.subTest(name=name, link=link), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp)
                with zipfile.ZipFile(path / "source.zip", "w") as archive:
                    info = zipfile.ZipInfo(name)
                    if link:
                        info.external_attr = 0o120777 << 16
                    archive.writestr(info, link or "data")
                (path / "out").mkdir()
                with self.assertRaises(ValueError):
                    installer.extract(path / "source.zip", path / "out")

    def test_portable_link_materialization(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            with zipfile.ZipFile(path / "source.zip", "w") as archive:
                archive.writestr("repo/assets/file", "asset")
                info = zipfile.ZipInfo("repo/link")
                info.external_attr = 0o120777 << 16
                archive.writestr(info, "assets/file")
            (path / "out").mkdir()
            source = installer.extract(path / "source.zip", path / "out")
            self.assertEqual((source / "link").read_text(), "asset")
            self.assertFalse((source / "link").is_symlink())


@unittest.skipIf(os.name == "nt", "Unix PATH and executable wrapper; Windows needs a native install check")
class InstallTests(unittest.TestCase):
    def test_command_works_outside_checkout_and_repeat_preserves_profile(self):
        with tempfile.TemporaryDirectory(prefix="grepleaks space ") as tmp:
            home = Path(tmp)
            (home / ".zshrc").write_text("# existing user settings\n")
            with patch.dict(os.environ, {"SHELL": "/bin/zsh", "ZDOTDIR": str(home)}):
                wrapper = installer.install(ROOT, home)
                installer.install(ROOT, home)
            profile = (home / ".zshrc").read_text()
            self.assertTrue(profile.startswith("# existing user settings\n"))
            self.assertEqual(profile.count(installer.MARKER), 1)
            result = subprocess.run([str(wrapper), "--help"], cwd=home, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--host-bridge", result.stdout)
            self.assertFalse(list((home / ".local/share/grepleaks").rglob(".env")))

    def test_existing_command_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            wrapper = home / ".local/bin/grepleaks"
            wrapper.parent.mkdir(parents=True)
            wrapper.write_text("unrelated command")
            with self.assertRaisesRegex(ValueError, "Refusing to overwrite"):
                installer.install(ROOT, home)
            self.assertEqual(wrapper.read_text(), "unrelated command")

    def test_failed_build_does_not_install(self):
        with patch.object(sys, "argv", ["install.py", "--source", str(ROOT)]), patch.object(installer.subprocess, "run", side_effect=[None, subprocess.CalledProcessError(1, "docker build")]), patch.object(installer, "install") as install:
            self.assertEqual(installer.main(), 1)
            install.assert_not_called()


@unittest.skipUnless(os.name == "nt", "Native Windows command and PATH registration")
class WindowsInstallTests(unittest.TestCase):
    def test_installed_command_and_user_path(self):
        import ctypes
        import winreg
        with tempfile.TemporaryDirectory(prefix="grepleaks space ") as tmp:
            home = Path(tmp)
            with patch.dict(os.environ, {"LOCALAPPDATA": str(home)}), patch.object(winreg, "CreateKey") as key, patch.object(winreg, "QueryValueEx", return_value=("C:\\existing", winreg.REG_EXPAND_SZ)), patch.object(winreg, "SetValueEx") as save, patch.object(ctypes.windll.user32, "SendMessageTimeoutW"):
                wrapper = installer.install(ROOT, home)
                key.assert_called_with(winreg.HKEY_CURRENT_USER, "Environment")
                self.assertEqual(save.call_args.args[-1], str(home / "Grepleaks/bin") + ";C:\\existing")
            result = subprocess.run([str(wrapper), "--help"], cwd=home, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--host-bridge", result.stdout)


if __name__ == "__main__":
    unittest.main()
