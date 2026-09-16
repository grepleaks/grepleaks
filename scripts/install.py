#!/usr/bin/env python3
"""Per-user installer. No third-party Python dependencies or administrator access."""
import argparse
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile


RUNTIME = (
    "scripts/launch.py", "host/bridge.py", "host/stage.py", "docker/config.py",
    "LICENSE", "THIRD_PARTY_NOTICES.md",
)
MARKER = "# Grepleaks user installation"


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    origin = parser.add_mutually_exclusive_group(required=True)
    origin.add_argument("--source", type=Path, help="Install from a local checkout")
    origin.add_argument("--repository", help="GitHub owner/repository")
    parser.add_argument("--ref", default="main", help="Git branch, tag or commit (default: main)")
    args = parser.parse_args()
    if sys.version_info < (3, 10):
        parser.error("Python 3.10+ is required")
    try:
        subprocess.run(["docker", "info"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with tempfile.TemporaryDirectory(prefix="grepleaks-install-") as tmp:
            source = args.source.resolve() if args.source else None
            if source is None:
                if not re.fullmatch(r"[\w.-]+/[\w.-]+", args.repository) or not re.fullmatch(r"[\w./-]+", args.ref):
                    raise ValueError("Invalid GitHub repository or ref")
                archive = Path(tmp) / "source.zip"
                print("Downloading Grepleaks…", flush=True)
                urllib.request.urlretrieve(f"https://codeload.github.com/{args.repository}/zip/{args.ref}", archive)
                unpacked = Path(tmp) / "source"
                unpacked.mkdir()
                source = extract(archive, unpacked)
            for name in (*RUNTIME, "docker/Dockerfile"):
                if not (source / name).is_file():
                    raise ValueError(f"Missing installation file: {name}")
            print("Building the Grepleaks image. The first installation can take several minutes…", flush=True)
            subprocess.run(["docker", "build", "-f", "docker/Dockerfile", "-t", "grepleaks:local", "."], cwd=source, check=True)
            wrapper = install(source, Path.home())
        print(f"Installed: {wrapper}\nOpen a new terminal and run: grepleaks")
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"Grepleaks installation failed: {error}\nCheck that Docker is installed and running, and that enough disk space is available.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
