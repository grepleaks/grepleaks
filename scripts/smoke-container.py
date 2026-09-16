#!/usr/bin/env python3
"""Exercise the real Docker launcher, provider stream and approved host execution.

Uses a temporary local model stub and random test credentials; no paid provider.
Run explicitly after building: python3 scripts/smoke-container.py
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1]


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="grepleaks:local")
    parser.add_argument("--launcher", type=Path, help="Installed grepleaks command to exercise instead of the checkout launcher")
    parser.add_argument("--no-host-bridge", action="store_true", help="Check an explicitly container-only conversation")
    args = parser.parse_args()
    marker = "grepleaks-smoke-" + secrets.token_hex(6)
    calls = []

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            if self.headers.get("Authorization") != "Bearer " + credential:
                self.send_error(401)
                return
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append(request)
            system = "\n".join(str(item.get("content", "")) for item in request.get("messages", []) if item.get("role") in ("system", "developer"))
            expected = ["expert penetration tester and cybersecurity analyst", "Before every tool call", "kali-arsenal", "selecting-pentest-tooling", "Never purge preinstalled software"]
            if any(text not in system for text in expected) or "You are opencode, an interactive CLI tool" in system:
                self.send_error(422, "Grepleaks prompt or skill discovery missing")
                return
            tools = [item.get("function", {}).get("name") for item in request.get("tools", [])]
            completed = any(item.get("role") == "tool" for item in request.get("messages", []))
            container_check = any("RUN_CONTAINER_CHECK" in json.dumps(item) for item in request.get("messages", []) if item.get("role") == "user")
            stage_check = any("STAGE_APP_CHECK" in json.dumps(item) for item in request.get("messages", []) if item.get("role") == "user")
            tool_name = "host_stage" if stage_check else "bash" if container_check else "host_run"
            use_tool = tool_name in tools and not completed
            delta = {"content": "Grepleaks smoke test complete."}
            if use_tool:
                delta = {"tool_calls": [{"index": 0, "id": "call_smoke", "type": "function", "function": {
                    "name": tool_name, "arguments": json.dumps(
                        {"path": str(source_app)} if stage_check else {"command": f"printf '%s' '{marker}' > /engagement/container-output.txt", "description": "Write the E2E workspace marker"}
                        if container_check else {"argv": [sys.executable, "-c", f"from pathlib import Path; Path('approved.txt').write_text({marker!r}); print({marker!r})"], "timeout": 10})}}]}
            chunks = [
                {"id": "chatcmpl-smoke", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"role": "assistant"}}]},
                {"id": "chatcmpl-smoke", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": delta}]},
                {"id": "chatcmpl-smoke", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls" if use_tool else "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}},
            ]
            payload = "".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(payload.encode())))
            self.end_headers()
            self.wfile.write(payload.encode())

    provider = ThreadingHTTPServer(("0.0.0.0", 0), Provider)
    thread = threading.Thread(target=provider.serve_forever, daemon=True)
    thread.start()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    credential = secrets.token_urlsafe(32)
    auth = "Basic " + base64.b64encode(("opencode:" + credential).encode()).decode()
    opener = build_opener(ProxyHandler({}))

    def api(path, data=None, authenticated=True):
        headers = {"Content-Type": "application/json", "x-opencode-directory": "/engagement"}
        if authenticated:
            headers["Authorization"] = auth if authenticated is True else authenticated
        req = Request(f"http://127.0.0.1:{port}{path}", data=None if data is None else json.dumps(data).encode(), headers=headers)
        with opener.open(req, timeout=45) as response:
            body = response.read()
            return json.loads(body) if body else None

    def wait_for(check, label, timeout=90):
        deadline = time.monotonic() + timeout
        last_error = None
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError("Launcher exited before " + label)
            try:
                result = check()
                if result:
                    return result
            except (URLError, TimeoutError, ConnectionError) as error:
                last_error = error
            time.sleep(0.25)
        raise RuntimeError(f"Timed out waiting for {label}; last connection error: {last_error}")

    # Colima shares home directories by default, but not macOS's system tempdir.
    with tempfile.TemporaryDirectory(prefix=".grepleaks-smoke-", dir=ROOT) as directory, tempfile.TemporaryDirectory(prefix=".grepleaks-smoke-app-", dir=ROOT) as artifact_directory:
        source_app = Path(artifact_directory) / "Sample App.app"
        (source_app / "Contents/MacOS").mkdir(parents=True)
        original = source_app / "Contents/MacOS/sample"
        original.write_bytes(b"sample-app-original")
        env = {k: v for k, v in os.environ.items() if not k.startswith(("BYOK_", "GREPLEAKS_", "OPENCODE_"))}
        env.update({"GREPLEAKS_STATE_DIR": str(Path(directory) / "state"), "GREPLEAKS_IMAGE": args.image, "GREPLEAKS_PORT": str(port), "OPENCODE_SERVER_PASSWORD": credential,
                    "BYOK_API_KEY": credential, "BYOK_MODEL": "smoke-model", "BYOK_BASE_URL": f"http://host.docker.internal:{provider.server_port}/v1"})
        logpath = Path(directory) / "launcher.log"
        with logpath.open("w+") as log:
            launcher = [str(args.launcher.resolve())] if args.launcher else [sys.executable, str(ROOT / "scripts/launch.py")]
            if args.launcher:
                version = subprocess.run(launcher + ["--version"], cwd=directory, env=env, capture_output=True, text=True, check=True, timeout=60)
                check(re.fullmatch(r"local|\d+\.\d+\.\d+(?:[-+].*)?", version.stdout.strip()), version.stdout)
            bridge = ["--no-host-bridge"] if args.no_host_bridge else []
            child = subprocess.Popen(launcher + bridge + ["--workspace", directory, "serve"], cwd=directory, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
            try:
                wait_for(lambda: api("/global/health"), "authenticated server health")
                ids = subprocess.run(["docker", "ps", "-q", "--filter", f"publish={port}"], capture_output=True, text=True, check=True).stdout.split()
                check(len(ids) == 1, ids)
                details = json.loads(subprocess.run(["docker", "inspect", ids[0]], capture_output=True, text=True, check=True).stdout)[0]
                check(not details["HostConfig"]["Privileged"], 'E2E check failed at 126')
                check(all(binding["HostIp"] == "127.0.0.1" for bindings in details["HostConfig"]["PortBindings"].values() for binding in bindings), 'E2E check failed at 127')
                check(sorted(mount["Destination"] for mount in details["Mounts"]) == ["/engagement", "/var/lib/grepleaks"], 'E2E check failed at 128')
                inventory = "import shutil; names=['bun','python3','nmap','ffuf','git']; missing=[n for n in names if not shutil.which(n)]; assert not missing, missing; print('Core tools available')"
                subprocess.run(["docker", "exec", ids[0], "python3", "-c", inventory], check=True, capture_output=True)
                for authentication in [False, "Basic invalid"]:
                    try:
                        api("/global/health", authenticated=authentication)
                        raise AssertionError("Invalid server authentication was accepted")
                    except HTTPError as error:
                        check(error.code == 401, error.code)
                        error.close()
                # Complete one denied turn before testing a separate approved session.
                denied = api("/session", {})["id"]
                api(f"/session/{denied}/prompt_async", {"parts": [{"type": "text", "text": "Run the harmless host smoke command."}]})
                if args.no_host_bridge:
                    wait_for(lambda: "Grepleaks smoke test complete." in json.dumps(api(f"/session/{denied}/message")), "plain model reply")
                    check(calls, "Provider was never called")
                    check(all("host_run" not in [t.get("function", {}).get("name") for t in c.get("tools", [])] for c in calls), 'E2E check failed at 144')
                    check(not (Path(directory) / "approved.txt").exists(), 'E2E check failed at 145')
                    sid = api("/session", {})["id"]
                    api(f"/session/{sid}/prompt_async", {"parts": [{"type": "text", "text": "RUN_CONTAINER_CHECK: write a harmless workspace marker."}]})
                    pending = wait_for(lambda: next((p for p in api("/permission") if p.get("permission") == "bash"), None), "container command permission")
                    check(not (Path(directory) / "container-output.txt").exists(), 'E2E check failed at 149')
                    api(f"/permission/{pending['id']}/reply", {"reply": "once"})
                    wait_for(lambda: "Grepleaks smoke test complete." in json.dumps(api(f"/session/{sid}/message")), "container tool and final reply")
                    check((Path(directory) / "container-output.txt").read_text() == marker, 'E2E check failed at 152')
                    print("PASS: default conversation, host tools absent, container tool approval, real workspace write, core tool inventory and loopback-only ports.")
                    return
                pending = wait_for(lambda: next((p for p in api("/permission") if p.get("permission") == "host_run"), None), "deniable host permission")
                check(not (Path(directory) / "approved.txt").exists(), 'E2E check failed at 156')
                api(f"/permission/{pending['id']}/reply", {"reply": "reject"})
                wait_for(lambda: any(p.get("tool") == "host_run" and p.get("state", {}).get("status") == "error" for m in api(f"/session/{denied}/message") for p in m.get("parts", [])), "rejected host tool result")
                check(not (Path(directory) / "approved.txt").exists(), "Rejected host command executed")
                completed_calls = len(calls)
                session = api("/session", {})
                sid = session["id"]
                api(f"/session/{sid}/prompt_async", {"parts": [{"type": "text", "text": "Run the harmless host smoke command and report its output."}]})
                pending = wait_for(lambda: next((p for p in api("/permission") if p.get("permission") == "host_run"), None), "host permission request")
                check(not (Path(directory) / "approved.txt").exists(), "Host command ran before approval")
                # The model must not receive host output before explicit approval.
                check(not any(marker in json.dumps(c.get("messages", [])) and any(m.get("role") == "tool" for m in c.get("messages", [])) for c in calls[completed_calls:]), 'E2E check failed at 167')
                api(f"/permission/{pending['id']}/reply", {"reply": "once"})
                messages = wait_for(lambda: (value if marker in json.dumps(value) and '"status": "completed"' in json.dumps(value) else None) if (value := api(f"/session/{sid}/message")) else None, "completed host command")
                check(marker in json.dumps(messages), 'E2E check failed at 170')
                check((Path(directory) / "approved.txt").read_text() == marker, 'E2E check failed at 171')
                wait_for(lambda: "Grepleaks smoke test complete." in json.dumps(api(f"/session/{sid}/message")), "final reply after tool output")
                check(any("host_run" in [t.get("function", {}).get("name") for t in c.get("tools", [])] for c in calls), 'E2E check failed at 173')
                staged_session = api("/session", {})["id"]
                api(f"/session/{staged_session}/prompt_async", {"parts": [{"type": "text", "text": "STAGE_APP_CHECK: copy the selected app for container analysis."}]})
                pending = wait_for(lambda: next((p for p in api("/permission") if p.get("permission") == "host_stage"), None), "artifact copy permission")
                exchange = Path(directory) / "state/exchange"
                check(not list(exchange.iterdir()), "Artifact copied before approval")
                api(f"/permission/{pending['id']}/reply", {"reply": "once"})
                part = wait_for(lambda: next((p for m in api(f"/session/{staged_session}/message") for p in m.get("parts", []) if p.get("tool") == "host_stage" and p.get("state", {}).get("status") == "completed"), None), "host artifact copy")
                transfer = json.loads(part["state"]["output"])
                check(transfer["exit_code"] == 0, "Artifact copy failed")
                staged = json.loads(transfer["output"])
                probe = "from pathlib import Path; import sys; p=Path(sys.argv[1])/'Contents/MacOS/sample'; data=p.read_bytes(); p.write_bytes(b'analysis-copy'); print(data.decode())"
                verification = subprocess.run(["docker", "exec", ids[0], "python3", "-c", probe, staged["container_path"]], check=True, text=True, capture_output=True)
                check(verification.stdout.strip() == "sample-app-original", "Container could not read the staged app")
                check(original.read_bytes() == b"sample-app-original", "Original application was modified")
                print("PASS: Docker startup, HTTP authentication, model streaming, rejected host action, approved real host execution, host app transfer and independent container analysis.")
            except BaseException:
                log.flush()
                print(logpath.read_text()[-12000:], file=sys.stderr)
                print("Provider requests:", len(calls), "Available tools:", [t.get("function", {}).get("name") for t in calls[-1].get("tools", [])] if calls else [], file=sys.stderr)
                raise
            finally:
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
                # Launcher may receive SIGTERM before Python's finally block runs.
                # Locate only this test's container by its unique published API port.
                containers = subprocess.run(["docker", "ps", "-q", "--filter", f"publish={port}"], text=True, capture_output=True)
                for container in containers.stdout.split():
                    subprocess.run(["docker", "stop", "-t", "2", container], stdout=subprocess.DEVNULL, check=False)
                provider.shutdown()
                provider.server_close()
                remaining = subprocess.run(["docker", "ps", "-q", "--filter", f"publish={port}"], capture_output=True, text=True, check=True)
                check(not remaining.stdout.strip(), "Test container survived launcher shutdown")
                for filename in ("approved.txt", "container-output.txt"):
                    path = Path(directory) / filename
                    if path.exists():
                        check(path.read_text() == marker, "Workspace output did not persist after shutdown")


if __name__ == "__main__":
    main()
