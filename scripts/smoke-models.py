#!/usr/bin/env python3
"""Real TUI model setup and persistence; fake credentials, no inference requests."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shlex
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default="grepleaks:local")
    parser.add_argument("--dev", action="store_true")
    args = parser.parse_args()
    socket = "grepleaks-models-" + secrets.token_hex(5)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("BYOK_", "GREPLEAKS_", "OPENCODE_"))}
    with tempfile.TemporaryDirectory(prefix=".grepleaks-models-", dir=ROOT) as directory:
        env.update(GREPLEAKS_STATE_DIR=directory, GREPLEAKS_IMAGE=args.image)
        def tmux(*parts):
            return subprocess.run(["tmux", "-L", socket, *parts], env=env, text=True, capture_output=True, check=True).stdout
        def screen():
            return tmux("capture-pane", "-pt", "ui")
        def wait(label, timeout=60):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                value = screen()
                if label in value: return value
                time.sleep(.2)
            raise RuntimeError("Missing UI label: " + label + "\n" + screen())
        def type_text(value):
            time.sleep(.2)
            tmux("send-keys", "-t", "ui", "-l", value)
        def enter():
            time.sleep(.2)
            tmux("send-keys", "-t", "ui", "Enter")
        def start():
            tmux("new-session", "-d", "-s", "ui", "-x", "120", "-y", "38", shlex.join([sys.executable, str(ROOT / "scripts/launch.py")] + (["--dev"] if args.dev else [])))
        def stop():
            for key in ["Escape", "C-c", "C-c"]:
                try: tmux("send-keys", "-t", "ui", key)
                except subprocess.CalledProcessError: return
                time.sleep(.3)
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                probe = subprocess.run(["tmux", "-L", socket, "has-session", "-t", "ui"], env=env, capture_output=True)
                if probe.returncode: return
                time.sleep(.2)
            raise RuntimeError("TUI did not exit")
        def check(condition, message):
            if not condition: raise AssertionError(message)
        try:
            start()
            wait("+ Add model")
            initial = wait("Grepleaks AI")
            check("Grepleaks AI" in initial, "Grepleaks missing")
            check("OpenCode Zen" not in initial, "Public catalog leaked into picker")
            enter()
            for label, value in [("Display name", "Local test A"), ("API base URL", "http://127.0.0.1:9/v1"), ("Exact model ID", "model-a")]:
                wait(label); type_text(value); enter()
            wait("Input hidden")
            secret = "test-only-" + secrets.token_hex(12)
            type_text(secret)
            tmux("set-buffer", "-b", "test-key", "pasted")
            tmux("paste-buffer", "-b", "test-key", "-t", "ui", "-p", "-d")
            secret += "pasted"
            time.sleep(.3)
            check("test-only-" not in screen() and secret not in screen(), "API key leaked into terminal")
            enter()
            wait("+ Add model")
            wait("Local test A")
            settings = Path(directory) / "config/opencode/opencode.json"
            credentials = Path(directory) / "data/opencode/auth.json"
            config = json.loads(settings.read_text())
            first = config["model"]
            check(secret not in settings.read_text(), "API key leaked into model configuration")
            check(any(x.get("key") == secret for x in json.loads(credentials.read_text()).values()), "Credential not persisted")
            # Second connection uses the permanently visible Grepleaks entry.
            type_text("Grepleaks AI"); enter()
            wait("API base URL"); type_text("http://127.0.0.1:9/v1"); enter()
            wait("Input hidden"); type_text("unused-grepleaks-test-key"); enter()
            wait("+ Add model")
            wait("Local test A")
            config = json.loads(settings.read_text())
            check(config["model"] == "grepleaks/basilisk-1", "Grepleaks was not selected")
            check(len(config["provider"]) == 2, "Adding Grepleaks lost the other model")
            # Select the saved custom connection and verify it survives restart.
            type_text("Local test A"); enter()
            wait("YOUR AI PENTEST ENVIRONMENT")
            deadline = time.monotonic() + 5
            while json.loads(settings.read_text())["model"] != first and time.monotonic() < deadline: time.sleep(.1)
            check(json.loads(settings.read_text())["model"] == first, "Selected model was not saved")
            stop(); start()
            wait("YOUR AI PENTEST ENVIRONMENT")
            type_text("/models"); enter()
            listing = wait("+ Add model")
            check("Local test A" in listing and "Grepleaks AI" in listing, "Saved connections missing after restart")
            check(json.loads(settings.read_text())["model"] == first, "Restart changed selected model")
            stop()
            saved_auth = json.loads(credentials.read_text())
            saved_auth.pop("grepleaks")
            credentials.write_text(json.dumps(saved_auth))
            start(); wait("YOUR AI PENTEST ENVIRONMENT")
            type_text("/models"); enter(); wait("+ Add model")
            type_text("Grepleaks AI"); enter()
            wait("Input hidden")
            check("Configure Grepleaks" in screen(), "Missing key did not reopen Grepleaks setup")
            check("API base URL" not in screen(), "Saved gateway URL was not reused")
            print("PASS: first-run setup, masked typing/paste, two connections, /models, selection persistence and missing-key recovery.")
        finally:
            try: stop()
            except (subprocess.CalledProcessError, RuntimeError): pass
            subprocess.run(["tmux", "-L", socket, "kill-server"], env=env, capture_output=True)


if __name__ == "__main__": main()
