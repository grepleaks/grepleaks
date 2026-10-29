#!/usr/bin/env python3
"""Back up and rebuild the Grepleaks session database.

The session database is a local SQLite file. A hard kill while the engine is
writing can leave it malformed. Engagement files live outside the database and
are never touched by this script.
"""
import argparse
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time


def counts(database):
    try:
        with sqlite3.connect(database) as connection:
            return {
                "sessions": connection.execute("select count(*) from session").fetchone()[0],
                "messages": connection.execute("select count(*) from message").fetchone()[0],
            }
    except sqlite3.DatabaseError:
        return None


def verify(database):
    try:
        with sqlite3.connect(database) as connection:
            return connection.execute("pragma integrity_check").fetchone()[0] == "ok"
    except sqlite3.DatabaseError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=Path.home() / ".grepleaks" / "state")
    args = parser.parse_args()

    database = args.state.expanduser().resolve() / "data" / "opencode" / "opencode-local.db"
    if not database.is_file():
        print(f"No session database at {database}")
        return 0

    backup = database.parent / ("backup-" + time.strftime("%Y%m%d-%H%M%S"))
    backup.mkdir(parents=True, exist_ok=False)
    for suffix in ("", "-wal", "-shm"):
        source = Path(str(database) + suffix)
        if source.exists():
            shutil.copy2(source, backup / source.name)
    print(f"Backup: {backup}")

    recovered = Path(tempfile.mkstemp(prefix="grepleaks-recovered-", suffix=".db")[1])

    def install(candidate):
        if not verify(candidate):
            return False
        for suffix in ("-wal", "-shm"):
            stale = Path(str(database) + suffix)
            if stale.exists():
                stale.unlink()
        candidate.replace(database)
        if os.name != "nt":
            database.chmod(0o600)
        summary = counts(database)
        print(f"Recovered: {database}")
        if summary:
            print(f"Sessions: {summary['sessions']}, messages: {summary['messages']}")
        return True

    try:
        sqlite_cli = shutil.which("sqlite3")
        if sqlite_cli:
            result = subprocess.run(
                [sqlite_cli, str(database), ".recover"],
                capture_output=True,
                text=True,
            )
            if result.returncode == 0 and result.stdout.strip():
                try:
                    with sqlite3.connect(recovered) as connection:
                        connection.executescript(result.stdout)
                    if install(recovered):
                        return 0
                except sqlite3.DatabaseError:
                    recovered.unlink()
                    recovered.touch()

        # Fallback for hosts without the sqlite3 CLI. This can still fail on a
        # badly damaged file, in which case the original stays in the backup.
        try:
            source = sqlite3.connect(database)
            script = "\n".join(source.iterdump())
            source.close()
            with sqlite3.connect(recovered) as target:
                target.executescript(script)
            if install(recovered):
                return 0
        except sqlite3.DatabaseError:
            pass

    finally:
        if recovered.exists():
            recovered.unlink()

    # Last resort: keep the backup and let the next launch create a new DB.
    database.replace(backup / database.name)
    for suffix in ("-wal", "-shm"):
        stale = Path(str(database) + suffix)
        if stale.exists():
            stale.unlink()
    print(
        "Could not recover the database. The original is in the backup directory "
        "and a new database will be created on the next launch.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
