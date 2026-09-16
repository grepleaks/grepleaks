#!/usr/bin/env python3
"""Authenticated host bridge. Host polls a Docker port published on loopback only."""
import hmac
import json
import os
from pathlib import Path
import platform
import queue
import secrets
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LIMIT = 65536

def validate(command):
    argv = command.get("argv")
    if not isinstance(argv, list) or not 1 <= len(argv) <= 128 or not all(isinstance(v, str) and len(v) <= 4096 and "\x00" not in v for v in argv):
        raise ValueError("argv must be a bounded array of strings")
    timeout = command.get("timeout", 60)
    if not isinstance(timeout, (int, float)) or not 1 <= timeout <= 120:
        raise ValueError("timeout must be 1..120 seconds")
    cwd = command.get("cwd")
    if cwd is not None and (not isinstance(cwd, str) or len(cwd) > 4096):
        raise ValueError("invalid cwd")
    return argv, timeout, cwd


def execute(command, workspace, stop):
    argv, timeout, cwd = validate(command)
    if os.name == "nt" and Path(argv[0]).suffix.lower() in (".bat", ".cmd"):
        return {"error": "Batch files require an explicit cmd.exe invocation for shell semantics"}
    directory = Path(cwd or workspace).expanduser().resolve()
    if not directory.is_dir():
        return {"error": "Host working directory does not exist"}
    env = {key: value for key, value in os.environ.items() if not key.startswith(("GREPLEAKS_HOST_", "BYOK_", "OPENCODE_CONFIG_CONTENT", "GREPLEAKS_API_"))}
    with tempfile.TemporaryFile() as output:
        options = {"start_new_session": True} if os.name != "nt" else {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        try:
            child = subprocess.Popen(argv, cwd=directory, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, shell=False, **options)
        except OSError:
            return {"error": "Could not start host command; check executable and platform"}
        deadline = time.monotonic() + timeout
        reason = None
        while child.poll() is None:
            if stop.is_set() or time.monotonic() >= deadline or os.fstat(output.fileno()).st_size > LIMIT:
                reason = "cancelled" if stop.is_set() else "timeout" if time.monotonic() >= deadline else "output limit"
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"], capture_output=True)
                else:
                    try: os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                child.kill()
                break
            stop.wait(0.05)
        child.wait()
        output.seek(0)
        return {"exit_code": child.returncode, "output": output.read(LIMIT).decode("utf-8", errors="replace"), "stopped": reason}


class Broker(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, token):
        if len(token) < 32: raise ValueError("Bridge token too short")
        super().__init__(address, Handler)
        self.token = token
        self.pending = queue.Queue(maxsize=1)
        self.current = {}
        self.lock = threading.Lock()
        self.info = None
        self.last_poll = 0


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try: self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError): pass
    def do_POST(self):
        self.connection.settimeout(130)
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + self.server.token):
            self.reply(401, {"error": "Unauthorized"}); return
        # Browser-origin requests are never part of this local protocol.
        if self.headers.get("Origin"):
            self.reply(403, {"error": "Browser requests are not accepted"}); return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= LIMIT * 8: raise ValueError()
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict): raise ValueError()
        except (ValueError, OSError):
            self.reply(400, {"error": "Invalid request"}); return
        if self.path == "/poll":
            self.server.info = data.get("info")
            self.server.last_poll = time.monotonic()
            try: job = self.server.pending.get(timeout=1)
            except queue.Empty: job = None
            self.reply(200, {"job": job}); return
        if self.path == "/info":
            self.reply(200, {"host": self.server.info, "connected": time.monotonic() - self.server.last_poll < 5}); return
        if self.path == "/result":
            with self.server.lock:
                job = self.server.current.get(data.get("id"))
                if job:
                    job["result"] = data.get("result")
                    job["event"].set()
            self.reply(200, {"ok": bool(job)}); return
        if self.path != "/request":
            self.reply(404, {"error": "Not found"}); return
        try: _, timeout, _ = validate(data)
        except ValueError:
            self.reply(400, {"error": "Invalid command"}); return
        if time.monotonic() - self.server.last_poll >= 5:
            self.reply(503, {"error": "Host companion is not connected"}); return
        identity = secrets.token_hex(16)
        job = {"event": threading.Event(), "result": None}
        with self.server.lock:
            if self.server.current:
                self.reply(409, {"error": "Another host command is running"}); return
            self.server.current[identity] = job
        try:
            self.server.pending.put_nowait({"id": identity, "command": data, "expires": time.time() + timeout + 5})
            finished = job["event"].wait(timeout + 5)
            self.reply(200 if finished else 504, job["result"] if finished else {"error": "Host command timed out; inspect host before retrying"})
        finally:
            with self.server.lock: self.server.current.pop(identity, None)


def request(url, token, route, data):
    req = urllib.request.Request(url + route, json.dumps(data).encode(), {"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    # Never send the local pairing credential through HTTP_PROXY/HTTPS_PROXY.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        response = opener.open(req, timeout=130)
    except urllib.error.HTTPError as error:
        error.close()
        raise
    with response:
        return json.loads(response.read(LIMIT * 8))


def worker(url, token, workspace, stop, exchange=None):
    info = {"os": platform.system(), "architecture": platform.machine(), "workspace": str(workspace)}
    if exchange is not None:
        info.update({"exchange": str(exchange), "container_exchange": "/var/lib/grepleaks/exchange",
                     "python": sys.executable, "stage_script": str(Path(__file__).with_name("stage.py"))})
    while not stop.is_set():
        try:
            job = request(url, token, "/poll", {"info": info}).get("job")
            if job and job["expires"] > time.time() and not stop.is_set():
                result = execute(job["command"], workspace, stop)
                request(url, token, "/result", {"id": job["id"], "result": result})
        except (OSError, ValueError, KeyError, urllib.error.URLError):
            stop.wait(0.5)


if __name__ == "__main__":
    token = os.environ.get("GREPLEAKS_HOST_TOKEN", "")
    Broker(("0.0.0.0", 8788), token).serve_forever()
