# Changelog

Releases are tagged `vX.Y.Z` and published on the
[releases page](https://github.com/grepleaks/grepleaks/releases). Installation and
upgrade steps live in [INSTALL.md](INSTALL.md).

## [0.1.3] - 2026-11-10

### Security

- **Host companion:** every host command is now confirmed in a native dialog on
  the host itself (macOS, Windows, Linux with zenity or kdialog), showing the
  exact command, folder and time limit. Deny is the default; without a dialog
  the command is refused. The in-app prompt ran inside the container and could
  be bypassed by a command running there. The bridge no longer inherits the
  provider keys.
- **Scope enforcement fails closed:** an invalid scope file or an empty
  `in_scope` denies every request. URLs are compared after parsing, so queries,
  case, dot segments, encoded slashes and default ports no longer get past an
  out-of-scope entry; redirects are scope-checked hop by hop; CIDR entries apply
  to resolved hostnames.
- **State directory:** the launcher never follows a symlink planted in the
  state directory (launcher files, workspace, exchange, session database,
  `--repair-db`).
- **Updates:** `grepleaks update` no longer falls back to `main` when the
  release lookup fails, and refuses a downgrade unless
  `GREPLEAKS_ALLOW_DOWNGRADE=1`.

### Fixed

- The IDOR oracle reported a vulnerability when access control worked (the
  second identity was denied). It now requires the non-owner to receive the
  owner's data.
- Replays of authenticated findings sent the stored `[redacted]` credential;
  the auth profile now supplies the real one.
- Managed models: the environment setup used a retired model id, and the
  missing context limit disabled auto-compaction. Both are fixed, including for
  configurations saved before.
- Native Linux Docker: the second launch failed with `Permission denied`
  (root-owned state). Files are handed back to the host user.
- `--repair-db` stops leftover session containers first and works on Windows.

### Changed

- Idle CPU: the home animation runs at 12 fps and pauses when the terminal is
  unfocused; the credit balance and findings panel stop polling redundantly.
- Updates reuse the Docker cache instead of rebuilding every layer, and an
  offline launch no longer waits on the release lookup.
- Since 0.1.2: evidence workflow and runtime installer, agent evaluation
  fixtures in CI, CodeQL hardening and dependency updates.

## [0.1.2] - 2026-10-29

### Added

- Issue and pull request templates. A bug report asks for the version, the host
  and Docker, and the shortest reproduction; security reports go to the private
  advisory flow.

### Changed

- The tree is 1700 files and 8 MB lighter. The unused web UI package is gone (the
  TUI keeps the five notification sounds it actually played), stray and empty
  files are removed, and the Docker context skips test fixtures so the image no
  longer carries a test suite.
- Dependabot proposes minor and patch updates only. Major bumps change the TUI and
  model APIs and invalidate the versions pinned in `engine/patches/`, so they are
  done by hand.

### Fixed

- A missing or stopped Docker daemon no longer ends in a Python traceback. The
  launcher probes `docker info` first and stops with one sentence that says
  whether Docker is missing or its daemon is down. Docker calls in the container
  reaping and image-label paths also tolerate a missing binary; `--console` and
  `--repair-db` keep working without a daemon.

### Security

- Patched the advisories that had a compatible fix: dompurify 3.4.17 (critical
  `SAFE_FOR_TEMPLATES` bypass), vite 7.3.7 and body-parser 2.4.0 (high), zod
  4.6.7 for every zod 4 consumer, and seroval 1.6.12. Three families stay pinned
  with the reason recorded next to the CI audit: the MCP SDK version the
  `determineScope` patch targets, `toml` 4.x which effect allows, and the EOL
  zod 3 line pulled by third-party SDKs.

## [0.1.1] - 2026-10-29

### Added

- Automatic tool refresh: the image records its build date and source ref, and the
  launcher rebuilds it in the background once it is seven days old, with
  `docker build --pull`. Preinstalled tools follow Debian instead of a stale layer
  cache; the running session keeps its tools and the next launch uses the new
  image. `GREPLEAKS_AUTO_UPDATE` and `GREPLEAKS_UPDATE_DAYS` control it.
- `grepleaks update` (or `--update`) installs the newest release and rebuilds the
  image synchronously.
- A newer release is announced at startup: Enter updates on the spot, `n` skips
  that version. The check is cached for a day and never blocks startup.
- The first run leads with the Grepleaks key, `ctrl+k` copies the console link,
  and the launcher opens `grepleaks.com/console` in the browser once.
  `grepleaks console` reopens it at any time.
- `grepleaks --repair-db` backs up and rebuilds a damaged session database.
- `abliterated-model-large-flash` in the managed model list: 1M context, text and
  images, reasoning off / low / high / max.

### Changed

- The host companion is opt-in: container-only is the default, `--host-bridge`
  enables commands on the real host.
- Reasoning-effort tiers mirror abliteration's per-model table.
- The skill pack and the tooling dictionary are in English, and on-demand
  installs use methods that exist on Debian instead of assumed Kali packages.
- The Dockerfile installs Bun from the signed release archive and verifies the
  SHA-256 per architecture.
- CI adds CodeQL and Dependabot, cancels superseded runs and stops persisting
  checkout credentials.

### Fixed

- Session containers no longer pile up: the launcher handles SIGHUP, labels its
  container with the state id, and the next launch stops anything this state
  directory no longer owns.
- `abliterated-model-large` is deprecated upstream; it stays accepted by the
  gateway for existing keys and is no longer offered in the UI.

### Removed

- The upstream OpenCode CI directory under `engine/.github`; GitHub only reads the
  repository root.

## [0.1.0] - 2026-09-17

Initial public release: terminal agent, Docker tool environment, on-demand tool
installation with cleanup, managed Grepleaks key, host companion, persistent
engagement files, and the source-available license.
