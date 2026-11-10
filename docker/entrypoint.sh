#!/usr/bin/env bash
set -euo pipefail
umask 077
export XDG_CONFIG_HOME=/var/lib/grepleaks/config
export XDG_DATA_HOME=/var/lib/grepleaks/data
export XDG_STATE_HOME=/var/lib/grepleaks/state
export GREPLEAKS_WORKSPACE="${GREPLEAKS_WORKSPACE:-/engagement}"
mkdir -p /run/grepleaks
chmod 700 /run/grepleaks
if [ "${1:-}" = serve ] && [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo 'Grepleaks: OPENCODE_SERVER_PASSWORD is required for serve.' >&2
  exit 1
fi
if [ -n "${GREPLEAKS_HOST_TOKEN:-}" ]; then
  # The plugin reads this file; the container shell environment does not keep
  # the pairing credential. host_bridge.py keeps its own copy from this env.
  printf '%s' "$GREPLEAKS_HOST_TOKEN" > /run/grepleaks/host-token
  chmod 600 /run/grepleaks/host-token
  # Minimal environment: the bridge must not inherit provider API keys, which
  # the agent's shell could read back from /proc/<pid>/environ.
  env -i PATH="$PATH" GREPLEAKS_HOST_TOKEN="$GREPLEAKS_HOST_TOKEN" python3 /opt/grepleaks/host_bridge.py >/dev/null 2>&1 &
fi
python3 /opt/grepleaks/config.py
unset OPENCODE_CONFIG_CONTENT
# Provider credentials are persisted to the private auth store by config.py.
# Do not leave them in the process environment where the shell tool can read them.
unset GREPLEAKS_HOST_TOKEN GREPLEAKS_API_KEY GREPLEAKS_API_URL BYOK_API_KEY BYOK_BASE_URL BYOK_MODEL BYOK_PROVIDER_NAME
export OPENCODE_CONFIG=/run/grepleaks/config.json
export OPENCODE_DISABLE_PROJECT_CONFIG=1
export OPENCODE_DISABLE_AUTOUPDATE=1
if [ "${1:-}" = serve ]; then
  shift
  set -- serve --port 4096 --hostname 0.0.0.0 "$@"
elif [ "${1:-}" != run ]; then
  set -- /engagement "$@"
fi

# Native Linux Docker: the container runs as root, so files it creates in the
# bind mounts end up root-owned (mode 0700 with umask 077) and the next launch
# fails with "Permission denied". The launcher passes the host user's ids;
# hand the state and workspace back to them on start and on exit.
if [[ "${GREPLEAKS_HOST_UID:-}" =~ ^[0-9]+$ && "${GREPLEAKS_HOST_GID:-}" =~ ^[0-9]+$ && "$GREPLEAKS_HOST_UID" != 0 ]]; then
  give_back() { chown -R "$GREPLEAKS_HOST_UID:$GREPLEAKS_HOST_GID" /var/lib/grepleaks /engagement 2>/dev/null || true; }
  give_back
  # <&0: a background job would otherwise get /dev/null as stdin (no TUI input).
  grepleaks "$@" <&0 &
  child=$!
  # docker stop sends TERM to PID 1 (this shell): forward it. Ctrl+C reaches
  # the TUI directly; ':' (not '') so the child keeps the default handler.
  trap 'kill -TERM "$child" 2>/dev/null' TERM HUP
  trap ':' INT
  status=0
  wait "$child" || status=$?
  # wait returns early when a trapped signal arrives: wait for the real exit.
  while kill -0 "$child" 2>/dev/null; do wait "$child" || status=$?; done
  give_back
  exit "$status"
fi
exec grepleaks "$@"
