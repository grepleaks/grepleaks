# Changelog

Releases are tagged `vX.Y.Z` and published on the
[releases page](https://github.com/grepleaks/grepleaks/releases). Installation and
upgrade steps live in [INSTALL.md](INSTALL.md).

## [Unreleased]

### Fixed

- A missing or stopped Docker daemon no longer ends in a Python traceback. The
  launcher probes `docker info` before it touches state and stops with one
  sentence that names the problem and the fix; Docker calls in the container
  reaping and image-label paths also tolerate a missing binary. `--console` and
  `--repair-db` keep working without a daemon.

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
