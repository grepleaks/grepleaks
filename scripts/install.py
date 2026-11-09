#!/usr/bin/env python3
"""Per-user installer. No third-party Python dependencies or administrator access."""
import argparse
import hashlib
import hmac
import json
import os
import platform
import ssl
import time
from datetime import datetime, timezone
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile


RUNTIME = (
    "scripts/launch.py", "scripts/install.py", "scripts/repair-db.py", "host/bridge.py", "host/stage.py",
    "docker/config.py", "LICENSE", "THIRD_PARTY_NOTICES.md", "LICENSES/0-MIT.txt",
)
MARKER = "# Grepleaks user installation"


def fetch(url, archive):
    """Download url to archive. Retries with an explicit CA bundle when the
    interpreter has no configured certificate store (python.org macOS builds)."""
    request = urllib.request.Request(url, headers={"User-Agent": "grepleaks-installer"})
    try:
        with urllib.request.urlopen(request) as response, archive.open("wb") as output:
            shutil.copyfileobj(response, output)
        return
    except urllib.error.URLError as error:
        if not isinstance(getattr(error, "reason", None), ssl.SSLCertVerificationError):
            raise
    bundles = []
    try:
        import certifi
        bundles.append(Path(certifi.where()))
    except ImportError:
        pass
    bundles += [Path("/etc/ssl/cert.pem"), Path("/etc/ssl/certs/ca-certificates.crt")]
    for bundle in bundles:
        if not bundle.is_file():
            continue
        context = ssl.create_default_context(cafile=str(bundle))
        try:
            with urllib.request.urlopen(request, context=context) as response, archive.open("wb") as output:
                shutil.copyfileobj(response, output)
            return
        except urllib.error.URLError:
            continue
    raise


def extract(archive, destination):
    """Extract GitHub sources without allowing paths or links outside the archive."""
    root = destination.resolve()
    links = []
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            if "\\" in entry.filename or ":" in entry.filename:
                raise ValueError("Unsafe archive path")
            target = (root / entry.filename).resolve()
            if not target.is_relative_to(root):
                raise ValueError("Unsafe archive path")
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            mode = entry.external_attr >> 16
            if mode & 0o170000 == 0o120000:
                linked = (target.parent / bundle.read(entry).decode()).resolve()
                if not linked.is_relative_to(root):
                    raise ValueError("Unsafe archive link")
                links.append((target, linked))
                continue
            with bundle.open(entry) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            if mode & 0o111:
                target.chmod(0o755)
    # Materialize links so Windows does not need developer mode or administrator rights.
    for target, linked in links:
        if linked.is_dir():
            shutil.copytree(linked, target)
        else:
            shutil.copyfile(linked, target)
    candidates = list(root.iterdir())
    if len(candidates) != 1 or not candidates[0].is_dir():
        raise ValueError("Expected one repository directory in the archive")
    return candidates[0]


def install(source, home):
    windows = os.name == "nt"
    base = (Path(os.environ.get("LOCALAPPDATA", home / "AppData/Local")) / "Grepleaks"
            if windows else home / ".local/share/grepleaks")
    bindir = base / "bin" if windows else home / ".local/bin"
    wrapper = bindir / ("grepleaks.cmd" if windows else "grepleaks")
    if wrapper.exists() and MARKER not in wrapper.read_text():
        raise ValueError(f"Refusing to overwrite an existing command: {wrapper}")
    for name in RUNTIME:
        if not (source / name).is_file():
            raise ValueError(f"Missing installation file: {name}")
    base.mkdir(parents=True, exist_ok=True)
    bindir.mkdir(parents=True, exist_ok=True)
    # A version directory keeps the current command usable until all copies finish.
    runtime = Path(tempfile.mkdtemp(prefix="runtime-", dir=base))
    try:
        for name in RUNTIME:
            dest = runtime / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / name, dest)
        if windows:
            content = f'@echo off\nrem {MARKER}\n"{sys.executable}" "{runtime / "scripts/launch.py"}" %*\n'
        else:
            content = f'#!/bin/sh\n{MARKER}\nexec {shlex.quote(sys.executable)} {shlex.quote(str(runtime / "scripts/launch.py"))} "$@"\n'
        pending = wrapper.with_suffix(".installing")
        pending.write_text(content)
        pending.chmod(0o755)
        pending.replace(wrapper)
    except BaseException:
        shutil.rmtree(runtime)
        raise
    if windows:
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            try:
                current, kind = winreg.QueryValueEx(key, "Path")
            except FileNotFoundError:
                current, kind = "", winreg.REG_EXPAND_SZ
            if str(bindir).casefold() not in [p.casefold() for p in current.split(";")]:
                winreg.SetValueEx(key, "Path", 0, kind, str(bindir) + ";" + current)
        import ctypes
        from ctypes import wintypes
        send = ctypes.windll.user32.SendMessageTimeoutW
        send.argtypes = [wintypes.HWND, wintypes.UINT, ctypes.c_size_t,
                         wintypes.LPCWSTR, wintypes.UINT, wintypes.UINT,
                         ctypes.POINTER(ctypes.c_size_t)]
        send.restype = ctypes.c_ssize_t
        result = ctypes.c_size_t()
        send(0xFFFF, 0x1A, 0, "Environment", 2, 1000, ctypes.byref(result))
    else:
        line = '\n' + MARKER + '\nexport PATH="$HOME/.local/bin:$PATH"\n'
        shell = Path(os.environ.get("SHELL", "/bin/sh")).name
        profiles = [home / ".profile"]
        if shell == "zsh":
            profiles.append(Path(os.environ.get("ZDOTDIR", str(home))) / ".zshrc")
        elif shell == "bash":
            profiles.extend([home / ".bashrc", home / ".bash_profile"])
        elif shell == "fish":
            config = home / ".config/fish/conf.d/grepleaks.fish"
            config.parent.mkdir(parents=True, exist_ok=True)
            config.write_text('fish_add_path "$HOME/.local/bin"\n')
        for profile in profiles:
            if not profile.exists() or MARKER not in profile.read_text():
                with profile.open("a") as output:
                    output.write(line)
    return wrapper


def detect_version(source, repository, ref):
    """Version label reported by `grepleaks --version`."""
    if repository:
        return ref
    try:
        described = subprocess.run(["git", "describe", "--tags", "--always"], cwd=source,
                                   capture_output=True, text=True, check=True).stdout.strip()
        return described or "local"
    except (OSError, subprocess.CalledProcessError):
        return "local"


RUNTIME_HELP = """\
Grepleaks needs a Docker-compatible container runtime.

  macOS:   brew install colima docker && colima start
           or install Docker Desktop: https://www.docker.com/products/docker-desktop/
  Linux:   sudo apt-get install docker.io && sudo systemctl enable --now docker
           (or dnf/pacman/zypper/apk; add your user to the docker group)
  Windows: winget install -e --id Docker.DockerDesktop
           then start Docker Desktop.

Already using OrbStack, Rancher Desktop or Podman? Start it and make sure
`docker info` works (Podman needs the docker-compatible CLI). Then rerun the
installer. See INSTALL.md.
"""


def _add_runtime_paths():
    """Add Docker Desktop/OrbStack CLI locations that may be missing from PATH."""
    candidates = [
        Path("/Applications/Docker.app/Contents/Resources/bin"),
        Path.home() / ".docker/bin",
        Path("/Applications/OrbStack.app/Contents/MacOS/bin"),
        Path.home() / ".orbstack/bin",
        Path("/opt/homebrew/bin"),
        Path("/usr/local/bin"),
    ]
    for candidate in candidates:
        if candidate.is_dir() and ((candidate / "docker").exists() or (candidate / "brew").exists()):
            os.environ["PATH"] = f"{candidate}:" + os.environ.get("PATH", "")


def detect_runtime():
    """Report the container runtimes visible on this host without changing it."""
    _add_runtime_paths()
    system = platform.system()
    program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    return {
        "system": system,
        "docker": bool(shutil.which("docker")),
        "colima": bool(shutil.which("colima")),
        "orbstack": bool(shutil.which("orb")) or (system == "Darwin" and Path("/Applications/OrbStack.app").is_dir()),
        "rancher": bool(shutil.which("rdctl")) or (system == "Darwin" and Path("/Applications/Rancher Desktop.app").is_dir()),
        "desktop": (system == "Darwin" and Path("/Applications/Docker.app").is_dir())
        or (system == "Windows" and (program_files / "Docker" / "Docker" / "Docker Desktop.exe").is_file()),
        "podman": bool(shutil.which("podman")),
    }


def docker_works():
    """True when the Docker CLI can reach a usable daemon."""
    try:
        probe = subprocess.run(
            ["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return probe.returncode == 0


def docker_storage_problem():
    """Return the Docker storage error when the image store is visibly broken."""
    try:
        result = subprocess.run(["docker", "system", "df"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode == 0:
        return None
    text = ((result.stderr or "") + "\n" + (result.stdout or "")).strip()
    lowered = text.lower()
    if "input/output error" in lowered or "failed to retrieve image list" in lowered or "containerd" in lowered:
        return text
    return None


def _print_storage_problem(problem):
    print("Grepleaks: Docker is reachable, but its image store is failing:", file=sys.stderr)
    print(problem[-2000:], file=sys.stderr)
    print(
        "Grepleaks: restart Docker Desktop (or repair its VM disk), then rerun the installer.",
        file=sys.stderr,
    )


def runtime_ready():
    if not docker_works():
        return False
    problem = docker_storage_problem()
    if problem:
        _print_storage_problem(problem)
        return False
    return True


def wait_for_docker(seconds=180):
    deadline = time.monotonic() + seconds
    last_notice = 0.0
    while time.monotonic() < deadline:
        if docker_works():
            return True
        if time.monotonic() - last_notice >= 10:
            print("Grepleaks: waiting for the container runtime…", flush=True)
            last_notice = time.monotonic()
        time.sleep(1)
    return docker_works()


def _run(argv, **kwargs):
    print("+ " + " ".join(shlex.quote(str(item)) for item in argv), flush=True)
    try:
        return subprocess.run(argv, check=False, **kwargs)
    except OSError as error:
        print(f"  failed: {error}", file=sys.stderr)
        return subprocess.CompletedProcess(argv, 127)


def _brew_prefix():
    try:
        result = subprocess.run(["brew", "--prefix"], capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None


def _privileged():
    """Return the privilege prefix for service/package commands."""
    if os.name == "nt":
        return []
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        return []
    return ["sudo"] if shutil.which("sudo") else []


def start_runtime(status):
    """Start an already-installed runtime. Never installs anything."""
    if status["colima"]:
        print("Grepleaks: starting Colima…", flush=True)
        _run(["colima", "start"])
        if wait_for_docker(240):
            return True
    if status["desktop"]:
        system = status["system"]
        if system == "Darwin":
            _run(["open", "-a", "Docker"])
        elif system == "Windows":
            executable = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Docker" / "Docker" / "Docker Desktop.exe"
            if executable.is_file():
                try:
                    subprocess.Popen([str(executable)])
                except OSError as error:
                    print(f"Grepleaks: could not start Docker Desktop: {error}", file=sys.stderr)
        if wait_for_docker(240):
            return True
    if status["orbstack"] and status["system"] == "Darwin":
        _run(["open", "-a", "OrbStack"])
        if wait_for_docker(180):
            return True
    if status["rancher"] and status["system"] == "Darwin":
        _run(["open", "-a", "Rancher Desktop"])
        if wait_for_docker(180):
            return True
    if status["system"] == "Linux":
        if shutil.which("systemctl"):
            _run(_privileged() + ["systemctl", "start", "docker"])
            if wait_for_docker(60):
                return True
        if shutil.which("service"):
            _run(_privileged() + ["service", "docker", "start"])
            if wait_for_docker(60):
                return True
    return docker_works()


def install_macos():
    if not shutil.which("brew"):
        return False
    if _run(["brew", "install", "colima", "docker"]).returncode != 0:
        return False
    prefix = _brew_prefix()
    if prefix:
        os.environ["PATH"] = f"{prefix}/bin:" + os.environ.get("PATH", "")
    if _run(["colima", "start"]).returncode != 0:
        return False
    print(
        "Grepleaks: if the image build runs out of memory later, run "
        "`colima stop && colima start --cpu 4 --memory 6` and retry.",
        flush=True,
    )
    return wait_for_docker(300)


def install_linux():
    sudo = _privileged()
    if shutil.which("apt-get"):
        commands = [sudo + ["apt-get", "update"], sudo + ["apt-get", "install", "-y", "docker.io"]]
    elif shutil.which("dnf"):
        commands = [sudo + ["dnf", "install", "-y", "docker"]]
    elif shutil.which("yum"):
        commands = [sudo + ["yum", "install", "-y", "docker"]]
    elif shutil.which("pacman"):
        commands = [sudo + ["pacman", "-S", "--noconfirm", "docker"]]
    elif shutil.which("zypper"):
        commands = [sudo + ["zypper", "--non-interactive", "install", "docker"]]
    elif shutil.which("apk"):
        commands = [sudo + ["apk", "add", "docker"]]
    else:
        return False
    for command in commands:
        if _run(command).returncode != 0:
            return False
    if shutil.which("systemctl"):
        _run(sudo + ["systemctl", "enable", "--now", "docker"])
    elif shutil.which("service"):
        _run(sudo + ["service", "docker", "start"])
    elif shutil.which("rc-update"):
        _run(sudo + ["rc-update", "add", "docker", "default"])
        _run(sudo + ["service", "docker", "start"])
    user = os.environ.get("USER") or os.environ.get("LOGNAME")
    if user and shutil.which("usermod"):
        _run(sudo + ["usermod", "-aG", "docker", user])
    if wait_for_docker(120):
        return True
    print(
        "Grepleaks: Docker is installed. If your shell is not in the docker group yet, "
        "log out and back in (or run `newgrp docker`), then rerun the installer.",
        file=sys.stderr,
    )
    return False


def install_windows():
    if not shutil.which("winget"):
        return False
    result = _run(
        [
            "winget",
            "install",
            "--id",
            "Docker.DockerDesktop",
            "-e",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ]
    )
    if result.returncode != 0:
        return False
    print("Grepleaks: starting Docker Desktop; Windows may ask for elevation.", flush=True)
    return start_runtime(detect_runtime()) or wait_for_docker(300)


def runtime_plan(status):
    system = status["system"]
    if system == "Darwin":
        if shutil.which("brew"):
            return "Homebrew will install Colima + the Docker CLI and start a Linux VM."
        return None
    if system == "Linux":
        return "The distribution package manager will install Docker Engine and enable the service (sudo may ask for your password)."
    if system == "Windows":
        if shutil.which("winget"):
            return "winget will install Docker Desktop; Windows may ask for elevation."
        return None
    return None


def ensure_runtime(assume_yes, allow_install):
    """Check, start or offer to install a Docker-compatible runtime."""
    _add_runtime_paths()
    if runtime_ready():
        return True
    if docker_works():
        # Reachable but unhealthy: runtime_ready already explained the storage failure.
        return False
    status = detect_runtime()
    if status["podman"] and not status["docker"]:
        print(
            "Grepleaks: Podman was found, but Grepleaks uses the Docker CLI; "
            "install podman-docker or Docker.",
            file=sys.stderr,
        )
    if any(status[key] for key in ("docker", "colima", "orbstack", "rancher", "desktop", "podman")):
        print("Grepleaks: a container runtime is installed but not reachable. Trying to start it…", flush=True)
        if start_runtime(status):
            return runtime_ready()
        print("Grepleaks: could not start the installed runtime.", file=sys.stderr)
    else:
        print("Grepleaks: no Docker-compatible container runtime was found.", flush=True)

    plan = runtime_plan(status)
    if not allow_install or not plan:
        print(RUNTIME_HELP, file=sys.stderr)
        return False
    print(f"Grepleaks: {plan}")
    if not assume_yes:
        if not sys.stdin.isatty():
            print("Grepleaks: no interactive terminal; skipping automatic runtime installation.", file=sys.stderr)
            print(RUNTIME_HELP, file=sys.stderr)
            return False
        try:
            answer = input("Install the container runtime now? [y/N] ").strip().lower()
        except EOFError:
            answer = ""
        if answer not in ("y", "yes"):
            print(RUNTIME_HELP, file=sys.stderr)
            return False

    print("Grepleaks: installing the container runtime. This can take several minutes…", flush=True)
    system = status["system"]
    installed = install_macos() if system == "Darwin" else install_linux() if system == "Linux" else install_windows() if system == "Windows" else False
    if installed:
        if runtime_ready():
            print("Grepleaks: container runtime is ready.")
            return True
        return False
    print("Grepleaks: automatic installation did not complete.", file=sys.stderr)
    print(RUNTIME_HELP, file=sys.stderr)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    origin = parser.add_mutually_exclusive_group(required=False)
    origin.add_argument("--source", type=Path, help="Install from a local checkout")
    origin.add_argument("--repository", help="GitHub owner/repository")
    parser.add_argument("--ref", default="main", help="Git branch, tag or commit (default: main)")
    parser.add_argument("--sha256", help="Expected SHA-256 of the downloaded codeload source ZIP")
    parser.add_argument("--check-runtime", action="store_true", help="Print the detected container runtime and exit")
    parser.add_argument("--no-install-runtime", action="store_true", help="Do not offer to install a container runtime")
    parser.add_argument("--yes", action="store_true", help="Accept the container runtime installation prompt")
    args = parser.parse_args()
    if sys.version_info < (3, 10):
        parser.error("Python 3.10+ is required")
    if args.check_runtime:
        status = detect_runtime()
        status["docker_ready"] = docker_works()
        status["docker_storage_ready"] = status["docker_ready"] and docker_storage_problem() is None
        print(json.dumps(status, indent=2))
        return 0
    if not args.source and not args.repository:
        parser.error("one of --source or --repository is required")
    if args.source and args.sha256:
        parser.error("--sha256 applies only with --repository")
    if args.sha256 and not re.fullmatch(r"[0-9a-fA-F]{64}", args.sha256):
        parser.error("--sha256 must be a 64-character hexadecimal digest")
    if args.repository and args.ref == "main" and not args.sha256:
        print(
            "Grepleaks: 'main' is a moving branch. Pin --ref to a release tag and pass "
            "--sha256 for a verifiable install. See INSTALL.md.",
            file=sys.stderr,
        )
    allow_install = not args.no_install_runtime and os.environ.get("GREPLEAKS_INSTALL_RUNTIME", "1").lower() not in (
        "0",
        "false",
        "no",
    )
    assume_yes = args.yes or os.environ.get("GREPLEAKS_ASSUME_YES", "").lower() in ("1", "true", "yes")
    if not ensure_runtime(assume_yes, allow_install):
        print("Grepleaks installation failed: a healthy Docker-compatible runtime is required.", file=sys.stderr)
        return 1
    try:
        with tempfile.TemporaryDirectory(prefix="grepleaks-install-") as tmp:
            source = args.source.resolve() if args.source else None
            if source is None:
                if not re.fullmatch(r"[\w.-]+/[\w.-]+", args.repository) or not re.fullmatch(r"[\w./-]+", args.ref):
                    raise ValueError("Invalid GitHub repository or ref")
                archive = Path(tmp) / "source.zip"
                print("Downloading Grepleaks…", flush=True)
                fetch(f"https://codeload.github.com/{args.repository}/zip/{args.ref}", archive)
                if args.sha256:
                    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
                    if not hmac.compare_digest(digest, args.sha256.lower()):
                        raise ValueError("Source archive checksum does not match --sha256")
                unpacked = Path(tmp) / "source"
                unpacked.mkdir()
                source = extract(archive, unpacked)
            for name in (*RUNTIME, "docker/Dockerfile"):
                if not (source / name).is_file():
                    raise ValueError(f"Missing installation file: {name}")
            version = detect_version(source, args.repository, args.ref)
            print("Building the Grepleaks image. The first installation can take several minutes…", flush=True)
            built_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            source_ref = "source" if args.source else args.ref
            subprocess.run(["docker", "build", "--pull",
                            "--build-arg", f"OPENCODE_VERSION={version}",
                            "--build-arg", f"BUILT_AT={built_at}",
                            "--build-arg", f"UPDATE_REF={source_ref}",
                            "-f", "docker/Dockerfile", "-t", "grepleaks:local", "."], cwd=source, check=True)
            wrapper = install(source, Path.home())
        print(f"Installed Grepleaks {version}: {wrapper}\nOpen a new terminal and run: grepleaks")
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"Grepleaks installation failed: {error}\nCheck the Docker daemon and free disk space, then retry.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
