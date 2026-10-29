#!/usr/bin/env python3
"""Cross-platform launcher. The host companion is opt-in via --host-bridge."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import signal
import sqlite3
import subprocess
import sys
import ssl
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "host"))
from bridge import worker
sys.path.insert(0, str(ROOT / "docker"))
from config import configuration

_state_lock = None


def state_directory(env):
    return Path(env.get("GREPLEAKS_STATE_DIR") or Path.home() / ".grepleaks" / "state").expanduser().resolve()


def acquire_state_lock(state):
    """Keep one launcher per state directory.

    Two containers writing the same SQLite database can corrupt it. The lock is
    held by this process and released by the OS on exit or crash.
    """
    global _state_lock
    if _state_lock is not None:
        return _state_lock
    handle = (state / ".launcher.lock").open("a+")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write("0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise ValueError(
            "Another Grepleaks session is already using this state directory. "
            "Close it, or set GREPLEAKS_STATE_DIR to a different directory."
        ) from None
    _state_lock = handle
    return handle


UPDATE_DAYS_DEFAULT = 7
UPDATE_RETRY_SECONDS = 24 * 3600


def image_name(env):
    return env.get("GREPLEAKS_IMAGE", "grepleaks:local")


def image_label(image, key):
    probe = subprocess.run(
        ["docker", "image", "inspect", image, "--format", '{{index .Config.Labels "' + key + '"}}'],
        text=True, capture_output=True,
    )
    if probe.returncode != 0:
        return None
    raw = probe.stdout.strip()
    if not raw or raw == "<no value>":
        return None
    return raw


def image_age_days(image):
    """Days since the image was built, or None when it carries no build date."""
    raw = image_label(image, "org.grepleaks.built")
    if raw is None:
        return None
    try:
        built = datetime.strptime(raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return max(0.0, (datetime.now(timezone.utc) - built).total_seconds() / 86400)


def ssl_contexts():
    """Default context first, then an explicit CA bundle: some macOS Python
    builds ship without a configured certificate store."""
    yield None
    bundles = []
    try:
        import certifi
        bundles.append(certifi.where())
    except ImportError:
        pass
    bundles += ["/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"]
    for bundle in bundles:
        if os.path.isfile(bundle):
            yield ssl.create_default_context(cafile=bundle)


def latest_release(repository, timeout=8):
    """Newest published tag, so an update lands on a release and not on main."""
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/releases/latest",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "grepleaks-launcher"},
    )
    payload = None
    for context in ssl_contexts():
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
                payload = json.load(response)
            break
        except urllib.error.URLError as error:
            if not isinstance(getattr(error, "reason", None), ssl.SSLCertVerificationError):
                raise
    if payload is None:
        raise ValueError("Release lookup failed")
    tag = payload.get("tag_name")
    if not isinstance(tag, str) or not re.fullmatch(r"[\w./-]+", tag):
        raise ValueError("Unexpected release tag")
    return tag


def update_command(ref=None):
    """Only the installer can rebuild the image: the build context is not kept in
    the installed runtime, so the installer fetches the source and rebuilds."""
    installer = ROOT / "scripts" / "install.py"
    if not installer.is_file():
        raise ValueError("This installation has no installer; reinstall Grepleaks to update it")
    repository = os.environ.get("GREPLEAKS_UPDATE_REPOSITORY", "grepleaks/grepleaks")
    if ref is None:
        ref = os.environ.get("GREPLEAKS_UPDATE_REF", "").strip()
        if not ref:
            try:
                ref = latest_release(repository)
            except Exception:
                ref = "main"
    return [sys.executable, str(installer), "--repository", repository, "--ref", ref]


def run_update(ref=None):
    try:
        command_line = update_command(ref)
    except ValueError as error:
        print(f"Grepleaks: {error}", file=sys.stderr)
        return 1
    ref = command_line[command_line.index("--ref") + 1]
    print(f"Grepleaks: updating to {ref} and rebuilding the tool image…", file=sys.stderr, flush=True)
    return subprocess.call(command_line, cwd=str(ROOT), env=dict(os.environ))


UPDATE_CHECK_SECONDS = 24 * 3600


def parse_version(tag):
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", (tag or "").strip())
    return tuple(int(part) for part in match.groups()) if match else None


def cached_latest_release(state, repository):
    """One GitHub call a day at most: startup must not wait on the network."""
    cache = state / "update-check.json"
    try:
        saved = json.loads(cache.read_text())
        if time.time() - float(saved["checked_at"]) < UPDATE_CHECK_SECONDS:
            tag = saved.get("tag")
            if isinstance(tag, str):
                return tag
    except (OSError, ValueError, KeyError, TypeError):
        pass
    tag = latest_release(repository)
    try:
        cache.write_text(json.dumps({"checked_at": time.time(), "tag": tag}))
    except OSError:
        pass
    return tag


def notice_box(lines, width=70):
    inner = width - 4
    out = ["┌" + "─" * (width - 2) + "┐"]
    out += ["│ " + line[:inner].ljust(inner) + " │" for line in lines]
    out.append("└" + "─" * (width - 2) + "┘")
    return "\n".join(out)


def notify_update(state, env):
    """Offer a newer release before the session starts, with a one-key update."""
    if env.get("GREPLEAKS_CHECK_UPDATES", "1") == "0":
        return
    ref = image_label(image_name(env), "org.grepleaks.ref")
    current = parse_version(ref or "")
    if current is None:
        return  # branch, commit or local build: the user chose that on purpose
    repository = env.get("GREPLEAKS_UPDATE_REPOSITORY", "grepleaks/grepleaks")
    try:
        tag = cached_latest_release(state, repository)
    except Exception:
        return
    newer = parse_version(tag)
    if newer is None or newer <= current:
        return
    declined = state / "update-declined"
    try:
        if declined.read_text().strip() == tag:
            return
    except OSError:
        pass
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print(f"Grepleaks: {tag} is available (you are on {ref}). Run `grepleaks update` to install it.", file=sys.stderr)
        return
    print()
    print(notice_box([
        f"Grepleaks {tag} is available — you are on {ref}.",
        "Press Enter to update now, or type n to skip this version.",
    ]))
    print("  Update now? [Y/n] ", end="", flush=True)
    try:
        answer = sys.stdin.readline().strip().lower()
    except (KeyboardInterrupt, EOFError):
        answer = "n"
        print()
    if answer in ("", "y", "yes", "o", "oui"):
        print("Grepleaks: updating…", file=sys.stderr, flush=True)
        if run_update(tag) != 0:
            print("Grepleaks: the update failed; starting with the current version.", file=sys.stderr)
            return
        print("Grepleaks: updated. Starting the new version.", file=sys.stderr, flush=True)
        return
    try:
        declined.write_text(tag)
    except OSError:
        pass


def refresh_in_background(state, env):
    """Rebuild the image when it is past the configured age.

    This session keeps the image it started with; the next launch uses the new
    one. A failed rebuild is retried at most once a day.
    """
    if env.get("GREPLEAKS_AUTO_UPDATE", "1") == "0":
        return
    try:
        days = float(env.get("GREPLEAKS_UPDATE_DAYS", UPDATE_DAYS_DEFAULT))
    except ValueError:
        days = UPDATE_DAYS_DEFAULT
    age = image_age_days(image_name(env))
    if age is None or age < days:
        return
    marker = state / ".update-attempt"
    try:
        if marker.exists() and time.time() - marker.stat().st_mtime < UPDATE_RETRY_SECONDS:
            return
        marker.touch()
    except OSError:
        return
    ref = image_label(image_name(env), "org.grepleaks.ref")
    if not ref or ref == "source":
        return  # built from a local checkout: never refresh it behind the user
    try:
        command_line = update_command(ref)
    except ValueError:
        return
    log = state / "update.log"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        with log.open("a") as handle:
            handle.write(f"\n=== update started {stamp} ===\n")
            handle.flush()
            options = {"stdout": handle, "stderr": subprocess.STDOUT, "cwd": str(ROOT), "env": dict(env)}
            if os.name == "nt":
                options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
            else:
                options["start_new_session"] = True
            subprocess.Popen(command_line, **options)
    except OSError:
        return
    print(
        f"Grepleaks: the tool image is {age:.0f} days old. Updating it in the background; "
        f"this session keeps the tools it started with.\nGrepleaks: progress in {log}",
        file=sys.stderr, flush=True,
    )


def sessions_file(state):
    return state / "sessions.json"


def read_sessions(state):
    """Container name -> launcher pid, for the sessions this state dir started."""
    try:
        saved = json.loads(sessions_file(state).read_text())
    except (OSError, ValueError):
        return {}
    if not isinstance(saved, dict):
        return {}
    return {str(name): int(pid) for name, pid in saved.items() if isinstance(pid, (int, float))}


def write_sessions(state, sessions):
    try:
        sessions_file(state).write_text(json.dumps(sessions))
    except OSError:
        pass


def process_running(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def state_id(state):
    """Stable per-state-directory id, so one install never reaps another's."""
    return hashlib.sha256(str(state).encode()).hexdigest()[:12]


def running_containers(state):
    """Session containers of this state dir, plus pre-label leftovers by name."""
    listing = subprocess.run(
        ["docker", "ps", "--format", '{{.Names}}\t{{.Label "com.grepleaks.state"}}'],
        text=True, capture_output=True,
    )
    if listing.returncode != 0:
        return []
    mine = state_id(state)
    names = []
    for line in listing.stdout.splitlines():
        name, _, label = line.partition("\t")
        name, label = name.strip(), label.strip()
        if not name:
            continue
        if label == mine:
            names.append(name)
        elif not label and re.fullmatch(r"grepleaks-[0-9a-f]{12}", name):
            names.append(name)
    return names


def reap_sessions(state):
    """Stop containers whose launcher died with its terminal.

    A closed window or a killed launcher skips the cleanup block, which leaves a
    full engine container running. Only one launcher may hold the state lock, so
    any container that no live launcher owns is a leftover.
    """
    sessions = read_sessions(state)
    alive = {name: pid for name, pid in sessions.items() if process_running(pid)}
    stopped = 0
    for name in running_containers(state):
        if name in alive:
            continue
        subprocess.run(["docker", "stop", "-t", "5", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        stopped += 1
    write_sessions(state, alive)
    if stopped:
        print(f"Grepleaks: stopped {stopped} leftover session container(s) from a closed terminal.", file=sys.stderr)
    return alive


def check_database(state):
    database = state / "data" / "opencode" / "opencode-local.db"
    if not database.is_file():
        return
    try:
        with sqlite3.connect(database) as connection:
            result = connection.execute("pragma quick_check").fetchone()
    except sqlite3.OperationalError as error:
        if "locked" in str(error).lower():
            raise ValueError("The session database is locked; close other Grepleaks sessions and retry.") from None
        raise ValueError(f"The session database cannot be opened: {database}\nRun `grepleaks --repair-db`.") from None
    except sqlite3.DatabaseError:
        raise ValueError(
            f"The session database is malformed: {database}\n"
            "Run `grepleaks --repair-db` to back it up and rebuild it. Engagement files are untouched."
        ) from None
    if result and result[0] != "ok":
        raise ValueError(
            f"The session database is malformed: {database}\n"
            "Run `grepleaks --repair-db` to back it up and rebuild it. Engagement files are untouched."
        )


def repair_database(state):
    script = ROOT / "scripts" / "repair-db.py"
    if not script.is_file():
        raise ValueError("The repair script is missing from this installation.")
    return subprocess.call([sys.executable, str(script), "--state", str(state)])


def configure(env, interactive):
    try:
        configuration(env)
    except (ValueError, KeyError):
        raise ValueError("Invalid provider configuration. Check the API URL (HTTP(S), no embedded credentials) or OPENCODE_CONFIG_CONTENT. See INSTALL.md.") from None


def command(args, env, terminal, state):
    result = ["docker", "run", "--rm", "-i"]
    if terminal: result.append("-t")
    result += ["--add-host", "host.docker.internal:host-gateway"]
    for name in ("GREPLEAKS_API_KEY", "GREPLEAKS_API_URL", "BYOK_API_KEY", "BYOK_BASE_URL", "BYOK_MODEL", "BYOK_PROVIDER_NAME", "OPENCODE_CONFIG_CONTENT", "OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME", "GREPLEAKS_HOST_TOKEN"):
        if env.get(name): result += ["-e", name]
    def mount(source, destination, readonly=False):
        path = Path(source).expanduser().resolve()
        if not path.is_dir() or "," in str(path): raise ValueError("Mount source must be an existing directory without commas")
        result.extend(["--mount", f"type=bind,src={path},dst={destination}" + (",readonly" if readonly else "")])
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
    result += ["--name", args.container_name, "--label", f"com.grepleaks.state={state_id(state)}"]
    if args.host_bridge:
        result += ["-p", "127.0.0.1::8788"]
    return result + [env.get("GREPLEAKS_IMAGE", "grepleaks:local")] + args.command


def main():
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, interrupted)
    parser = argparse.ArgumentParser(allow_abbrev=False, description="Grepleaks — Your AI pentest environment. Build with docker build -f docker/Dockerfile -t grepleaks:local .")
    parser.add_argument("--dev", action="store_true", help="Mount local sources read-only; restart after edits")
    parser.add_argument("--workspace", help="Existing directory mounted read-write at /engagement")
    parser.add_argument("--host-access", action="store_true", help="Expose home or GREPLEAKS_HOST_ROOT read-write at /host")
    parser.add_argument("--repair-db", action="store_true", help="Back up and rebuild the session database")
    parser.add_argument("--update", action="store_true", help="Rebuild the tool image with the latest tools, then exit")
    bridge = parser.add_mutually_exclusive_group()
    bridge.add_argument("--host-bridge", dest="host_bridge", action="store_true", help="Enable the host companion: commands on the real host, after approval")
    bridge.add_argument("--no-host-bridge", dest="host_bridge", action="store_false", help="Disable the host companion (default); use the container only")
    parser.set_defaults(host_bridge=False)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args, forwarded = parser.parse_known_args()
    args.command = forwarded + args.command
    if args.command == ["update"]:
        args.update = True
        args.command = []
    # Version queries do not execute an agent or need a companion process.
    if args.command in (["--version"], ["-v"]):
        args.host_bridge = False
    env = dict(os.environ)
    # Never reuse a pairing credential from an earlier session.
    env.pop("GREPLEAKS_HOST_TOKEN", None)
    state = state_directory(env)
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name != "nt":
        state.chmod(0o700)
    if args.update:
        return run_update()
    try:
        acquire_state_lock(state)
    except (ValueError, OSError) as error:
        print(f"Grepleaks: {error}", file=sys.stderr)
        return 1
    if args.repair_db:
        return repair_database(state)
    if args.host_bridge:
        env["GREPLEAKS_HOST_TOKEN"] = secrets.token_urlsafe(48)
    if args.command not in (["--version"], ["-v"]):
        reap_sessions(state)
        notify_update(state, env)
    args.container_name = "grepleaks-" + secrets.token_hex(6)
    try:
        if args.command not in (["--version"], ["-v"]):
            check_database(state)
        terminal = sys.stdin.isatty() and sys.stdout.isatty()
        configure(env, terminal)
        if args.command not in (["--version"], ["-v"]):
            refresh_in_background(state, env)
        argv = command(args, env, terminal, state)
    except (EOFError, KeyboardInterrupt):
        print("\nGrepleaks: setup cancelled.", file=sys.stderr); return 130
    except (ValueError, OSError) as error:
        print(f"Grepleaks: {error}", file=sys.stderr); return 1
    stop = threading.Event()
    thread = None
    sessions = read_sessions(state)
    sessions[args.container_name] = os.getpid()
    write_sessions(state, sessions)
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
        return child.wait()
    except KeyboardInterrupt:
        return 130
    finally:
        stop.set()
        if args.container_name:
            print("Grepleaks: closing the session…", file=sys.stderr)
            subprocess.run(["docker", "stop", "-t", "5", args.container_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            sessions = read_sessions(state)
            sessions.pop(args.container_name, None)
            write_sessions(state, sessions)
        if child.poll() is None:
            child.terminate()
            try: child.wait(timeout=5)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
        if thread: thread.join(timeout=3)


if __name__ == "__main__":
    sys.exit(main())
