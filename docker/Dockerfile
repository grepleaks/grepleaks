# Grepleaks — Debian-based security toolbox running the FORKED engine FROM SOURCE.
#
# We run the engine from source (bun + node_modules) rather than a compiled
# binary: `bun build --compile` tree-shakes a module out of opencode's DI graph
# (makeLocationNode) → `node.name` crash at runtime. Source keeps the full graph.
#
# Debian slim core: a small set of rock-solid tools + package managers; the agent
# installs long-tail tools on demand (AGENTS.md) and cleans them up.
#
# Build (from repo root):  docker build -f docker/Dockerfile -t grepleaks:local .

FROM debian:stable-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PATH="/usr/local/bin:/root/.bun/bin:/root/go/bin:/usr/local/go/bin:${PATH}" \
    GOBIN=/usr/local/bin

# core toolkit + package managers (for install-on-demand) + build deps for node-pty
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget git jq unzip \
      python3 python3-pip python3-venv pipx golang-go ruby make g++ \
      nmap masscan dnsutils whois netcat-traditional \
      ffuf gobuster nikto whatweb sqlmap hydra \
    && rm -rf /var/lib/apt/lists/*

# bun runtime (runs the engine from source)
ARG BUN_VERSION=1.4.2
RUN curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"

# forked engine source + its deps
COPY engine/ /opt/grepleaks/engine/
RUN cd /opt/grepleaks/engine && /root/.bun/bin/bun install --frozen-lockfile \
    && rm -rf /root/.bun/install/cache

# `grepleaks` launcher. Must start bun with cwd = packages/opencode so bun picks
# up its bunfig.toml (solid JSX preload) + tsconfig (jsxImportSource) at module
# load — otherwise JSX defaults to react and the TUI crashes. PWD is pinned to
# the engagement dir so the commands resolve the workspace there.
RUN printf '#!/bin/bash\ncd /opt/grepleaks/engine/packages/opencode\nexport PWD=/engagement\nexec bun src/index.ts "$@"\n' > /usr/local/bin/grepleaks \
    && chmod +x /usr/local/bin/grepleaks

COPY host/bridge.py /opt/grepleaks/host_bridge.py
COPY docker/config.py /opt/grepleaks/config.py
COPY docker/entrypoint.sh /opt/grepleaks/entrypoint.sh
RUN chmod +x /opt/grepleaks/entrypoint.sh

# engagement workspace: skills + persona (referenced from the config)
WORKDIR /engagement
COPY engine/.opencode/skills/ /opt/grepleaks/skills/
COPY engine/AGENTS.grepleaks.md /opt/grepleaks/AGENTS.md
COPY LICENSE THIRD_PARTY_NOTICES.md /opt/grepleaks/

EXPOSE 4096
ENTRYPOINT ["/opt/grepleaks/entrypoint.sh"]
