#!/usr/bin/env python3
"""End-to-end check of the Grepleaks evidence workflow in the real container.

Runs the real launcher with a mock OpenAI-compatible provider and a local
vulnerable HTTP target. The provider drives the agent through:

  scope_check -> save_finding -> verify_finding -> generate_report -> scope_check (denied)

Then verifies the SQLite store, the summary, the HTML report, redaction, and
the out-of-scope refusal. No paid provider and no real target.

Run after building the image:
    python3 scripts/smoke-evidence.py

Run without Docker (real engine + mock provider + local target):
    python3 scripts/smoke-evidence.py --local
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
from urllib.parse import urlparse
from urllib.request import Request, build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1]
FINDING_TITLE = "SQL injection in login (evidence smoke)"
TARGET_PATH = "/sqli"


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="grepleaks:local")
    parser.add_argument("--launcher", type=Path, help="Installed grepleaks command to exercise")
    parser.add_argument("--keep", action="store_true", help="Keep the temporary workspace for inspection")
    parser.add_argument("--local", action="store_true", help="Run the engine directly with bun instead of the Docker launcher")
    args = parser.parse_args()

    marker = "grepleaks-evidence-" + secrets.token_hex(6)
    calls = []
    target_port = 0
    target_base = ""

    class Target(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path != TARGET_PATH:
                self.send_response(404)
                self.end_headers()
                return
            query = parsed.query
            if "'1'='2" in query or "1%27%3D%272" in query or "1'='2" in query:
                body = b"SQL syntax error near '1'='2'"
                self.send_response(500)
            elif "'1'='1" in query or "1%27%3D%271" in query or "1'='1" in query:
                body = b"A" * 120
                self.send_response(200)
            else:
                body = b"A" * 60
                self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            if self.headers.get("Authorization") != "Bearer " + credential:
                self.send_error(401)
                return
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append(request)
            messages = request.get("messages", [])
            tools = [item.get("function", {}).get("name") for item in request.get("tools", [])]
            tool_messages = [item for item in messages if item.get("role") == "tool"]
            step = len(tool_messages)

            def tool_call(name, arguments):
                return {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": "call_" + secrets.token_hex(4),
                            "type": "function",
                            "function": {"name": name, "arguments": json.dumps(arguments)},
                        }
                    ],
                }

            if not tools:
                delta = {"content": "Evidence smoke"}
            elif step == 0:
                if not all(name in tools for name in ("save_finding", "verify_finding", "generate_report", "scope_check")):
                    self.send_error(422, "Evidence tools missing: " + json.dumps(sorted(tools)))
                    return
                delta = tool_call("scope_check", {"target": f"{target_base}{TARGET_PATH}"})
            elif step in (1, 2):
                delta = tool_call(
                    "save_finding",
                    {
                        "title": FINDING_TITLE,
                        "category": "sqli",
                        "severity": "high",
                        "target": target_base,
                        "endpoint": f"{target_base}{TARGET_PATH}",
                        "parameter": "q",
                        "method": "GET",
                        "description": "The q parameter is concatenated into a SQL query and changes the boolean response.",
                        "impact": "Authentication bypass and data exfiltration.",
                        "remediation": "Use parameterized queries.",
                        "cwe": "CWE-89",
                        "cvss": 9.1,
                        "payload": "1' AND '1'='1",
                        "request_json": json.dumps(
                            {
                                "url": f"{target_base}{TARGET_PATH}",
                                "method": "GET",
                                "headers": {"Authorization": "Bearer secret", "Content-Type": "text/plain"},
                            }
                        ),
                        "response_json": json.dumps({"status": 500, "body": "SQL syntax error near '1'='2'"}),
                        "tags": "smoke,sqli",
                        "source": "smoke-evidence",
                    },
                )
            elif step == 3:
                finding = re.search(r"fnd_[a-z0-9]+", json.dumps(tool_messages[-1]))
                if not finding:
                    self.send_error(422, "save_finding did not return a finding id: " + json.dumps(tool_messages[-1])[:1000])
                    return
                delta = tool_call("verify_finding", {"id": finding.group(0)})
            elif step == 4:
                delta = tool_call("list_findings", {})
            elif step == 5:
                delta = tool_call("generate_report", {"format": "html", "title": "Evidence smoke"})
            elif step == 6:
                delta = tool_call("scope_check", {"target": "https://admin.example.com"})
            else:
                delta = {"content": f"Grepleaks evidence smoke complete {marker}."}

            chunks = [
                {"id": "chatcmpl-evidence", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"role": "assistant"}}]},
                {"id": "chatcmpl-evidence", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": delta}]},
                {
                    "id": "chatcmpl-evidence",
                    "object": "chat.completion.chunk",
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls" if "tool_calls" in delta else "stop"}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
                },
            ]
            payload = "".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(payload.encode())))
            self.end_headers()
            self.wfile.write(payload.encode())

    target = ThreadingHTTPServer(("0.0.0.0", 0), Target)
    target_port = target.server_port
    target_base = f"http://127.0.0.1:{target_port}" if args.local else f"http://host.docker.internal:{target_port}"
    threading.Thread(target=target.serve_forever, daemon=True).start()

    provider = ThreadingHTTPServer(("0.0.0.0", 0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        api_port = sock.getsockname()[1]
    credential = secrets.token_urlsafe(32)
    auth = "Basic " + base64.b64encode(("opencode:" + credential).encode()).decode()
    opener = build_opener(ProxyHandler({}))

    def api(path, data=None, authenticated=True):
        headers = {
            "Content-Type": "application/json",
            "x-opencode-directory": str(workspace) if args.local else "/engagement",
        }
        if authenticated:
            headers["Authorization"] = auth if authenticated is True else authenticated
        req = Request(
            f"http://127.0.0.1:{api_port}{path}",
            data=None if data is None else json.dumps(data).encode(),
            headers=headers,
        )
        with opener.open(req, timeout=60) as response:
            body = response.read()
            return json.loads(body) if body else None

    def wait_for(check_fn, label, timeout=120):
        deadline = time.monotonic() + timeout
        last_error = None
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError("Launcher exited before " + label)
            try:
                result = check_fn()
                if result:
                    return result
            except (URLError, TimeoutError, ConnectionError) as error:
                last_error = error
            time.sleep(0.25)
        raise RuntimeError(f"Timed out waiting for {label}; last connection error: {last_error}")

    workspace = Path(tempfile.mkdtemp(prefix=".grepleaks-evidence-", dir=ROOT))
    scope_path = workspace / "scope.json"
    auth_path = workspace / "auth.json"
    scope_path.write_text(
        json.dumps(
            {
                "engagement": "Evidence smoke",
                "client": "Grepleaks",
                "in_scope": ["127.0.0.1"] if args.local else ["host.docker.internal", "127.0.0.1"],
                "out_of_scope": ["admin.example.com"],
                "rate_limit": {"requests_per_second": 50},
                "attribution": {"X-Engagement": "evidence-smoke"},
            }
        )
    )
    auth_path.write_text(
        json.dumps(
            {
                "identities": [
                    {"label": "smoke", "role": "user", "auth": {"type": "bearer", "token": "secret"}}
                ]
            }
        )
    )

    provider_base = (
        f"http://127.0.0.1:{provider.server_port}/v1"
        if args.local
        else f"http://host.docker.internal:{provider.server_port}/v1"
    )
    env = {k: v for k, v in os.environ.items() if not k.startswith(("BYOK_", "GREPLEAKS_", "OPENCODE_"))}
    env.update(
        {
            "OPENCODE_SERVER_PASSWORD": credential,
            "OPENCODE_SERVER_USERNAME": "opencode",
            "BYOK_API_KEY": credential,
            "BYOK_MODEL": "smoke-model",
            "BYOK_BASE_URL": provider_base,
        }
    )
    logpath = workspace / "launcher.log"
    if args.local:
        config_path = workspace / "opencode.json"
        config_path.write_text(
            json.dumps(
                {
                    "$schema": "https://opencode.ai/config.json",
                    "model": "byok/smoke-model",
                    "provider": {
                        "byok": {
                            "npm": "@ai-sdk/openai-compatible",
                            "name": "BYOK",
                            "options": {"baseURL": provider_base, "apiKey": credential},
                            "models": {"smoke-model": {"name": "smoke-model"}},
                        }
                    },
                    "permission": {"*": "allow", "verify_finding": "ask"},
                    "instructions": [str(ROOT / "engine/AGENTS.grepleaks.md")],
                }
            )
        )
        env.update(
            {
                "OPENCODE_CONFIG": str(config_path),
                "OPENCODE_DISABLE_PROJECT_CONFIG": "1",
                "OPENCODE_PRINT_LOGS": "1",
                "GREPLEAKS_WORKSPACE": str(workspace),
                "GREPLEAKS_SCOPE": str(scope_path),
                "GREPLEAKS_AUTH": str(auth_path),
            }
        )
        child_command = ["bun", "run", "src/index.ts", "--print-logs", "serve", "--port", str(api_port), "--hostname", "127.0.0.1"]
        child_cwd = ROOT / "engine/packages/opencode"
    else:
        env.update(
            {
                "GREPLEAKS_STATE_DIR": str(workspace / "state"),
                "GREPLEAKS_IMAGE": args.image,
                "GREPLEAKS_PORT": str(api_port),
            }
        )
        launcher = [str(args.launcher.resolve())] if args.launcher else [sys.executable, str(ROOT / "scripts/launch.py")]
        child_command = launcher + [
            "--workspace",
            str(workspace),
            "--scope",
            str(scope_path),
            "--auth",
            str(auth_path),
            "serve",
        ]
        child_cwd = workspace
    child = None
    success = False
    try:
        with logpath.open("w+") as log:
            child = subprocess.Popen(
                child_command,
                cwd=child_cwd,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
            )
            wait_for(lambda: api("/global/health"), "authenticated server health")
            container = None
            if not args.local:
                container = subprocess.run(
                    ["docker", "ps", "-q", "--filter", f"publish={api_port}"],
                    capture_output=True,
                    text=True,
                    check=True,
                ).stdout.split()
                check(len(container) == 1, f"expected one container, got {container}")
                inspect = json.loads(
                    subprocess.run(["docker", "inspect", container[0]], capture_output=True, text=True, check=True).stdout
                )[0]
                destinations = sorted(mount["Destination"] for mount in inspect["Mounts"])
                check("/engagement" in destinations, f"engagement mount missing: {destinations}")
                check("/run/grepleaks/scope.json" in destinations, f"scope mount missing: {destinations}")
                check("/run/grepleaks/auth.json" in destinations, f"auth mount missing: {destinations}")

            session = api("/session", {})
            api(f"/session/{session['id']}/prompt_async", {"parts": [{"type": "text", "text": "Run the evidence smoke workflow."}]})

            def finding_id():
                for request in calls:
                    for message in request.get("messages", []):
                        if message.get("role") == "tool" and "fnd_" in json.dumps(message):
                            match = re.search(r"fnd_[a-z0-9]+", json.dumps(message))
                            if match:
                                return match.group(0)
                return None

            wait_for(finding_id, "save_finding id")
            pending = wait_for(
                lambda: next((p for p in api("/permission") if p.get("permission") == "verify_finding"), None),
                "verify_finding permission",
            )
            api(f"/permission/{pending['id']}/reply", {"reply": "once"})
            wait_for(
                lambda: "Grepleaks evidence smoke complete" in json.dumps(api(f"/session/{session['id']}/message")),
                "final evidence reply",
            )

            names = []
            for request in calls:
                for item in request.get("tools", []):
                    name = item.get("function", {}).get("name")
                    if name:
                        names.append(name)
            for expected in ("scope_check", "save_finding", "verify_finding", "generate_report"):
                check(expected in names, f"tool {expected} never advertised")

            all_tool_text = json.dumps(calls)
            check("ALLOWED" in all_tool_text, "in-scope scope_check did not return ALLOWED")
            check("DENIED" in all_tool_text, "out-of-scope scope_check did not return DENIED")
            check("reproduced" in all_tool_text.lower(), "verify_finding did not return reproduced")
            check("fnd_" in all_tool_text, "save_finding did not return a finding id")
            check("Merged into existing" in all_tool_text, "duplicate save was not merged into the existing finding")
            check("Findings: 1 total" in all_tool_text, "list_findings did not report exactly one finding")

            def host_path(path):
                return Path(str(path).replace("/engagement", str(workspace), 1))

            def exec_cat(path):
                if args.local:
                    return host_path(path).read_text()
                return subprocess.run(
                    ["docker", "exec", container[0], "cat", path],
                    capture_output=True,
                    text=True,
                    check=True,
                ).stdout

            def exec_test(path):
                if args.local:
                    return host_path(path).is_file()
                return subprocess.run(
                    ["docker", "exec", container[0], "test", "-f", path],
                    capture_output=True,
                    text=True,
                ).returncode == 0

            check(exec_test("/engagement/.grepleaks/findings.db"), "findings.db missing in the container")
            check(exec_test("/engagement/.grepleaks/summary.json"), "summary.json missing in the container")
            summary = json.loads(exec_cat("/engagement/.grepleaks/summary.json"))
            check(summary["total"] >= 1, f"summary total is {summary}")
            check(summary["verified"] >= 1, f"summary verified is {summary}")

            if args.local:
                report_files = sorted(str(item) for item in (workspace / ".grepleaks" / "reports").glob("*.html"))
            else:
                report_files = subprocess.run(
                    ["docker", "exec", container[0], "sh", "-c", "ls -1 /engagement/.grepleaks/reports/*.html"],
                    capture_output=True,
                    text=True,
                    check=True,
                ).stdout.split()
            check(report_files, "no HTML report was written")
            report = exec_cat(report_files[-1].strip())
            check(FINDING_TITLE in report, "report does not contain the finding title")
            check("reproduced" in report.lower(), "report does not contain the verification verdict")
            check("Bearer secret" not in report, "report leaked the Authorization header")
            check("[redacted]" in report, "report did not redact the Authorization header")

            if args.local:
                for item in (
                    workspace / ".grepleaks" / "findings.db",
                    workspace / ".grepleaks" / "findings.db-wal",
                    workspace / ".grepleaks" / "findings.db-shm",
                    workspace / ".grepleaks" / "summary.json",
                    Path(report_files[-1]),
                ):
                    if item.exists():
                        mode = item.stat().st_mode & 0o777
                        check(mode & 0o077 == 0, f"{item.name} is group/world accessible: {oct(mode)}")

            print("PASS: evidence tools registered, scope allowed/denied, finding saved and deduped,")
            print("      SQLi verification reproduced, HTML report written, secrets redacted.")
            print(f"      workspace: {workspace}")
            success = True
    except BaseException:
        if logpath.exists():
            print(logpath.read_text()[-10000:], file=sys.stderr)
        print("Provider requests:", len(calls), file=sys.stderr)
        if calls:
            print("Last tools:", [t.get("function", {}).get("name") for t in calls[-1].get("tools", [])], file=sys.stderr)
        raise
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        containers = subprocess.run(
            ["docker", "ps", "-q", "--filter", f"publish={api_port}"],
            capture_output=True,
            text=True,
            check=False,
        )
        if not args.local:
            for container in containers.stdout.split():
                subprocess.run(["docker", "stop", "-t", "2", container], stdout=subprocess.DEVNULL, check=False)
        provider.shutdown()
        provider.server_close()
        target.shutdown()
        target.server_close()
        if not args.keep and success:
            import shutil

            shutil.rmtree(workspace, ignore_errors=True)


if __name__ == "__main__":
    main()
