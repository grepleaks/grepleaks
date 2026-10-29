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
  mkdir -p /run/grepleaks
  chmod 700 /run/grepleaks
  # The plugin reads this file; the container shell environment does not keep
  # the pairing credential. host_bridge.py keeps its own copy from this env.
  printf '%s' "$GREPLEAKS_HOST_TOKEN" > /run/grepleaks/host-token
  chmod 600 /run/grepleaks/host-token
  python3 /opt/grepleaks/host_bridge.py >/dev/null 2>&1 &
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
  exec grepleaks serve --port 4096 --hostname 0.0.0.0 "$@"
fi
if [ "${1:-}" = run ]; then exec grepleaks "$@"; fi
exec grepleaks /engagement "$@"
