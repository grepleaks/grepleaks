#!/usr/bin/env python3
"""Exercise the real Docker TUI in an isolated tmux terminal; no model requests."""
import os
from pathlib import Path
import secrets
import shlex
import subprocess
import sys
import time
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    socket = "grepleaks-e2e-" + secrets.token_hex(6)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("BYOK_", "GREPLEAKS_", "OPENCODE_"))}
    state = tempfile.TemporaryDirectory(prefix=".grepleaks-tui-", dir=ROOT)
    env["GREPLEAKS_STATE_DIR"] = state.name
    env.update(BYOK_API_KEY="unused-local-test", BYOK_MODEL="smoke-model", BYOK_BASE_URL="http://127.0.0.1:9/v1")

    def tmux(*args):
        return subprocess.run(["tmux", "-L", socket, *args], env=env, text=True, capture_output=True, check=True).stdout

    def wait_text(text):
        deadline = time.monotonic() + 60
        screen = ""
        while time.monotonic() < deadline:
            screen = tmux("capture-pane", "-pt", "ui")
            if text.lower() in screen.lower():
                return screen
            time.sleep(0.25)
        raise AssertionError(f"Missing {text!r} in terminal:\n{screen}")

    try:
        tmux("new-session", "-d", "-s", "ui", "-x", "120", "-y", "38", shlex.join([sys.executable, str(ROOT / "scripts/launch.py")]))
        wait_text("YOUR AI PENTEST ENVIRONMENT")
        marker = "E2E unsent input"
        tmux("send-keys", "-t", "ui", "-l", marker)
        wait_text(marker)
        for width, height in [(80, 24), (160, 48), (120, 38)]:
            tmux("resize-window", "-t", "ui", "-x", str(width), "-y", str(height))
            wait_text(marker)
        tmux("send-keys", "-t", "ui", "C-p")
        wait_text("Stash prompt")
        tmux("send-keys", "-t", "ui", "Escape")
        wait_text(marker)
        print("PASS: real Docker TUI, branding, text input, three terminal sizes, command palette and preserved input.")
    finally:
        try:
            tmux("send-keys", "-t", "ui", "C-c", "C-c")
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                probe = subprocess.run(["tmux", "-L", socket, "has-session", "-t", "ui"], env=env, capture_output=True)
                if probe.returncode:
                    break
                time.sleep(0.25)
        finally:
            subprocess.run(["tmux", "-L", socket, "kill-server"], env=env, capture_output=True)
            state.cleanup()


if __name__ == "__main__":
    main()
