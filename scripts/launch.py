#!/usr/bin/env python3
"""Cross-platform launcher. Host companion is enabled by default and paired for one session."""
import argparse
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "host"))
from bridge import worker
sys.path.insert(0, str(ROOT / "docker"))
from config import configuration


def configure(env, interactive):
    try:
        configuration(env)
    except (ValueError, KeyError):
        raise ValueError("Invalid provider configuration. Check the API URL (HTTP(S), no embedded credentials) or OPENCODE_CONFIG_CONTENT. See INSTALL.md.") from None


def command(args, env, terminal):
    result = ["docker", "run", "--rm", "-i"]
    if terminal: result.append("-t")
    result += ["--add-host", "host.docker.internal:host-gateway"]
    for name in ("GREPLEAKS_API_KEY", "GREPLEAKS_API_URL", "BYOK_API_KEY", "BYOK_BASE_URL", "BYOK_MODEL", "BYOK_PROVIDER_NAME", "OPENCODE_CONFIG_CONTENT", "OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME", "GREPLEAKS_HOST_TOKEN"):
        if env.get(name): result += ["-e", name]
    def mount(source, destination, readonly=False):
        path = Path(source).expanduser().resolve()
        if not path.is_dir() or "," in str(path): raise ValueError("Mount source must be an existing directory without commas")
        result.extend(["--mount", f"type=bind,src={path},dst={destination}" + (",readonly" if readonly else "")])
    state = Path(env.get("GREPLEAKS_STATE_DIR") or Path.home() / ".grepleaks" / "state").expanduser().resolve()
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name != "nt": state.chmod(0o700)
    args.exchange = state / "exchange"
    args.exchange.mkdir(mode=0o700, exist_ok=True)
    mount(state, "/var/lib/grepleaks")
    workspace = args.workspace or state / "workspace"
    if not args.workspace:
        workspace.mkdir(mode=0o700, exist_ok=True)
    mount(workspace, "/engagement")
    if args.host_access:
        source = env.get("GREPLEAKS_HOST_ROOT") or str(Path.home())
        mount(source, "/host")
        result += ["-e", "GREPLEAKS_HOST_ACCESS=1"]
        print(f"Grepleaks: READ-WRITE host access enabled: {source} -> /host. Commands can modify or delete these files.", file=sys.stderr)
    if args.dev:
        sources = list((ROOT / "engine/packages").glob("*/src")) + list((ROOT / "engine/packages").glob("*/*/src"))
        if not sources: raise ValueError("Engine sources missing")
        for source in sources:
            if source.is_dir(): mount(source, "/opt/grepleaks/engine/" + source.relative_to(ROOT / "engine").as_posix(), True)
    if args.command and args.command[0] == "serve":
        if not env.get("OPENCODE_SERVER_PASSWORD"): raise ValueError("Set OPENCODE_SERVER_PASSWORD before starting the API")
        port = int(env.get("GREPLEAKS_PORT", "4096"))
        if not 1 <= port <= 65535: raise ValueError("Invalid port")
        result += ["-p", f"127.0.0.1:{port}:4096"]
    if args.host_bridge:
        result += ["--name", args.container_name, "-p", "127.0.0.1::8788"]
    return result + [env.get("GREPLEAKS_IMAGE", "grepleaks:local")] + args.command


def main():
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser(allow_abbrev=False, description="Grepleaks — Your AI pentest environment. Build with docker build -f docker/Dockerfile -t grepleaks:local .")
    parser.add_argument("--dev", action="store_true", help="Mount local sources read-only; restart after edits")
    parser.add_argument("--workspace", help="Existing directory mounted read-write at /engagement")
    parser.add_argument("--host-access", action="store_true", help="Expose home or GREPLEAKS_HOST_ROOT read-write at /host")
    bridge = parser.add_mutually_exclusive_group()
    bridge.add_argument("--host-bridge", dest="host_bridge", action="store_true", help="Enable the host companion (default)")
    bridge.add_argument("--no-host-bridge", dest="host_bridge", action="store_false", help="Disable commands on the host; use the container only")
    parser.set_defaults(host_bridge=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args, forwarded = parser.parse_known_args()
    args.command = forwarded + args.command
    # Version queries do not execute an agent or need a companion process.
    if args.command in (["--version"], ["-v"]):
        args.host_bridge = False
    env = dict(os.environ)
    # Never reuse a pairing credential from an earlier session.
    env.pop("GREPLEAKS_HOST_TOKEN", None)
    if args.host_bridge:
        env["GREPLEAKS_HOST_TOKEN"] = secrets.token_urlsafe(48)
        args.container_name = "grepleaks-" + secrets.token_hex(6)
    try:
        terminal = sys.stdin.isatty() and sys.stdout.isatty()
        configure(env, terminal)
        argv = command(args, env, terminal)
    except (EOFError, KeyboardInterrupt):
        print("\nGrepleaks: setup cancelled.", file=sys.stderr); return 130
    except (ValueError, OSError) as error:
        print(f"Grepleaks: {error}", file=sys.stderr); return 1
    stop = threading.Event()
    thread = None
    try:
        child = subprocess.Popen(argv, env=env)
    except OSError:
        print("Grepleaks: Docker is not available. See INSTALL.md.", file=sys.stderr); return 1
    try:
        if args.host_bridge:
            deadline = time.monotonic() + 30
            port = None
            while child.poll() is None and time.monotonic() < deadline:
                probe = subprocess.run(["docker", "port", args.container_name, "8788/tcp"], text=True, capture_output=True)
                address = probe.stdout.strip()
                if probe.returncode == 0 and address.startswith("127.0.0.1:") and address.count("\n") == 0:
                    port = int(address.rsplit(":", 1)[1]); break
                time.sleep(0.2)
            if port is None:
                if child.poll() is not None:
                    return child.returncode
                print("Grepleaks: companion pairing failed; stopping this session.", file=sys.stderr)
                return 1
            thread = threading.Thread(target=worker, args=(f"http://127.0.0.1:{port}", env["GREPLEAKS_HOST_TOKEN"], Path(args.workspace or Path.cwd()).resolve(), stop, args.exchange), daemon=True)
            thread.start()
            print("Grepleaks: host companion paired for this session. Host actions appear in permission prompts.", file=sys.stderr)
        return child.wait()
    except KeyboardInterrupt:
        return 130
    finally:
        stop.set()
        if args.host_bridge:
            subprocess.run(["docker", "stop", "-t", "2", args.container_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if child.poll() is None:
            child.terminate()
            try: child.wait(timeout=5)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
        if thread: thread.join(timeout=3)


if __name__ == "__main__":
    sys.exit(main())
