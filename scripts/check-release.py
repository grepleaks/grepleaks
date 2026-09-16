#!/usr/bin/env python3
"""Check the publication tree without printing secret values."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".git", "node_modules", "__pycache__", ".turbo"}

def check():
    errors = []
    baseline = json.loads((ROOT / "scripts/secret-baseline.json").read_text())
    for name, expected in baseline["files"].items():
        file = ROOT / name
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            errors.append(f"Secret-scan exception changed; review required: {name}")
    ignored = sorted(line.strip() for line in (ROOT / ".gitleaksignore").read_text().splitlines() if line.strip() and not line.startswith("#"))
    if ignored != baseline["fingerprints"]:
        errors.append("Gitleaks ignore list differs from reviewed baseline")
    count = 0
    for directory, dirs, names in os.walk(ROOT):
        dirs[:] = [name for name in dirs if name not in SKIP]
        for name in names:
            file = Path(directory) / name
            relative = file.relative_to(ROOT).as_posix()
            if file.is_symlink():
                try: file.resolve().relative_to(ROOT)
                except ValueError: errors.append(f"External symlink: {relative}")
                if not file.exists(): errors.append(f"Broken source symlink: {relative}")
                continue
            count += 1
            if name == ".env" or name.startswith(".env.") and name != ".env.example" or name in ("auth.json", "credentials.json"):
                errors.append(f"Private configuration filename: {relative}")
            if relative.startswith(("dev/", "botnet/", "tui/", "private/", "reports/", "engagements/")):
                errors.append(f"Local-only directory present: {relative}")
            data = file.read_bytes()
            if re.search(rb"sk-nano[-_]?[A-Za-z0-9_-]{16,}", data):
                errors.append(f"Provider token pattern: {relative}")
    for error in errors: print(error, file=sys.stderr)
    print(f"Publication structure checked: {count} files; {len(errors)} errors.")
    return not errors

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-gitleaks", action="store_true", help="Structure only; NOT a complete secret scan")
    args = parser.parse_args()
    if not check(): sys.exit(1)
    if args.no_gitleaks:
        print("Gitleaks not run (structure-only check).")
        sys.exit(0)
    executable = os.environ.get("GITLEAKS_BIN") or shutil.which("gitleaks")
    if not executable:
        print("Gitleaks is required for a complete release check.", file=sys.stderr)
        sys.exit(1)
    sys.exit(subprocess.run([executable, "dir", ".", "--redact=100", "--log-level", "error"], cwd=ROOT).returncode)
