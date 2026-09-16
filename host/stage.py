#!/usr/bin/env python3
"""Copy one selected host artifact into the shared container analysis area."""
import json
from pathlib import Path
import shutil
import sys
import tempfile


def stage(source, exchange):
    source = Path(source).expanduser().resolve(strict=True)
    exchange = Path(exchange).resolve(strict=True)
    if not exchange.is_dir() or not (source.is_file() or source.is_dir()):
        raise ValueError("Select a regular file or directory")
    if exchange.is_relative_to(source) or source.is_relative_to(exchange):
        raise ValueError("The source must be outside the shared analysis area and cannot contain it")
    pending = Path(tempfile.mkdtemp(prefix="pending-", dir=exchange))
    try:
        target = pending / source.name
        if source.is_dir():
            # Preserve bundle links without reading files outside the selected artifact.
            shutil.copytree(source, target, symlinks=True)
        else:
            shutil.copy2(source, target)
        ready = pending.with_name(pending.name.replace("pending-", "artifact-", 1))
        pending.rename(ready)
        return {
            "source": str(source),
            "host_path": str(ready / source.name),
            "container_path": "/var/lib/grepleaks/exchange/" + ready.name + "/" + source.name,
            "next_step": "Use container tools for static analysis of this copy. The original was not modified.",
        }
    except BaseException:
        shutil.rmtree(pending, ignore_errors=True)
        raise


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("Expected a source path and an exchange directory")
        print(json.dumps(stage(sys.argv[1], sys.argv[2])))
    except (OSError, ValueError):
        print("Could not stage the artifact. Check its path, read permissions and available disk space.", file=sys.stderr)
        sys.exit(1)
