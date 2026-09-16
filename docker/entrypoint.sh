#!/usr/bin/env bash
set -euo pipefail
umask 077
export XDG_CONFIG_HOME=/var/lib/grepleaks/config
export XDG_DATA_HOME=/var/lib/grepleaks/data
export XDG_STATE_HOME=/var/lib/grepleaks/state
if [ "${1:-}" = serve ] && [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo 'Grepleaks: OPENCODE_SERVER_PASSWORD is required for serve.' >&2
  exit 1
fi
if [ -n "${GREPLEAKS_HOST_TOKEN:-}" ]; then
  python3 /opt/grepleaks/host_bridge.py >/dev/null 2>&1 &
fi
python3 /opt/grepleaks/config.py
unset OPENCODE_CONFIG_CONTENT
export OPENCODE_CONFIG=/run/grepleaks/config.json
export OPENCODE_DISABLE_PROJECT_CONFIG=1
export OPENCODE_DISABLE_AUTOUPDATE=1
if [ "${1:-}" = serve ]; then
  shift
  exec grepleaks serve --port 4096 --hostname 0.0.0.0 "$@"
fi
if [ "${1:-}" = run ]; then exec grepleaks "$@"; fi
exec grepleaks /engagement "$@"
