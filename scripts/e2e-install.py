#!/usr/bin/env python3
"""Build, install into an isolated user directory, and exercise the installed command.

Uses real Docker and a local model fixture, never a paid provider. Run on macOS
or Linux with Docker running. Does not change the user's shell configuration.
"""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def main():
    if os.name == "nt":
        raise SystemExit("This isolated Unix installation E2E does not validate Windows registry setup.")
    spec = importlib.util.spec_from_file_location("installer_e2e", ROOT / "scripts/install.py")
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    with tempfile.TemporaryDirectory(prefix=".grepleaks-smoke-install space-", dir=ROOT) as tmp:
        home = Path(tmp)
        # Only redirect installation destinations; Docker and all subprocesses are real.
        with patch.object(Path, "home", return_value=home), patch.dict(os.environ, {"ZDOTDIR": str(home), "SHELL": "/bin/zsh"}), patch.object(sys, "argv", ["install.py", "--source", str(ROOT)]):
            if installer.main() != 0:
                raise RuntimeError("Installation failed")
        wrapper = home / ".local/bin/grepleaks"
        env = {**os.environ, "PATH": str(wrapper.parent) + os.pathsep + os.environ["PATH"]}
        result = subprocess.run(["grepleaks", "--help"], cwd=home, env=env, capture_output=True, text=True, check=True)
        assert "--host-bridge" in result.stdout
        assert "grepleaks" in (home / ".zshrc").read_text().lower()
        print("PASS: real image build, isolated installation, PATH lookup and command outside the checkout.", flush=True)
        for flags in [[], ["--no-host-bridge"]]:
            subprocess.run([sys.executable, str(ROOT / "scripts/smoke-container.py"), "--launcher", str(wrapper), *flags], check=True)
        print("PASS: installed command with and without the host companion.", flush=True)


if __name__ == "__main__":
    main()
