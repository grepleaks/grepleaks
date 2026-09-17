# Host companion (preview)

The companion lets the agent request commands on macOS, Windows or Linux while
keeping Linux pentest tools in Docker. It starts automatically with the standard launcher and runs as the signed-in user,
without requesting administrator/root elevation. It does not bypass OS privacy, hardware or privilege
requirements.

The companion is enabled by default. `--host-bridge` remains a compatible explicit
flag; use `--no-host-bridge` to disable it. Host commands retain their approval
flow. Help and version queries do not start a companion.

## One launch

Install Docker and Python 3.10+ once, then use:

```bash
./grepleaks --workspace /path/to/engagement
```

On native Windows (Python launcher and Docker Desktop installed):

```bat
grepleaks.cmd --workspace C:\Engagements
```

No separate terminal, pairing code or permanent API key is needed. The launcher
starts a companion, generates a random session credential and publishes the broker
on a temporary **127.0.0.1-only** Docker port. The host polls that local broker;
there is no inbound listening service installed on the host. The companion stops
with the launch session. It is not installed as a background service.

The agent receives `host_info`, `host_stage` and `host_run`. It must inspect the host OS before
selecting commands. `host_run` presents a permission request labelled HOST in the
usual TUI; there is no second host-terminal confirmation. Arguments are passed
without an implicit shell. A shell requires an explicit argv such as the actual
platform's shell executable. Output and execution time are bounded.

## Analyze any host file or directory inside Docker

This workflow accepts any selected file or directory: source code, executables,
archives, documents, packet captures and application bundles. No extension filter
or macOS-specific transfer command is used. For example:

- macOS: `/Users/alice/Projects/sample` or `/Applications/Example.app`
- Windows: `C:\Users\Alice\Downloads\sample.exe` or `C:\Projects\sample`
- Linux: `/home/alice/projects/sample` or `/home/alice/capture.pcap`

Give Grepleaks the path as it exists on the host.
The agent is instructed to use `host_stage` to copy that artifact, then run static
analysis tools inside Docker on the returned `container_path`. The transfer uses
the existing TUI permission flow. It preserves the original and copies symlinks
without following their targets.

Copies live under `~/.grepleaks/state/exchange` by default (or the configured
`GREPLEAKS_STATE_DIR/exchange`), mounted at `/var/lib/grepleaks/exchange` in Docker.
They are stored in the shared runtime directory, **not baked into the image**:
there is no image rebuild for each application. Copies persist across sessions
and consume disk space until removed. This is an analysis copy, not a forensic
image or a guarantee that all platform-specific metadata is preserved.

A macOS `.app` cannot run natively in the Linux container. Binary inspection,
resource review and other compatible static analysis run on the copy in Docker;
macOS runtime/UI tests still use the host companion. Windows executables likewise
need an appropriate runtime for dynamic tests. Linux execution also depends on
compatible architecture, libraries and container capabilities. The agent should explain which
part of the analysis requires host execution.

## Trust boundary

Enabling the companion authorizes a local execution capability outside Docker.
The TUI permission prompt is an application-level control, not a cryptographic
proof of human approval. Code already executing inside the container can access
its session environment and contact the authenticated broker; a fully compromised
container must therefore be considered capable of using the host connection.
Do not enable the companion for untrusted plugins or workflows. Host commands can
access the user's files and accounts. Docker administrators can inspect container
environments. Pairing credentials are ephemeral and are not written to the repo.

No automatic software installation, sudo/UAC escalation, login item, firewall rule
or global Docker configuration change is performed. Killing an entire application
or process tree may still have side effects; this is not a host sandbox.

## Validation status

The protocol and child-process tests pass on macOS and Linux. The complete Docker
launcher, model tool request, permission gate and native host execution have been
tested on macOS with Colima using a temporary local model stub. Run
`python3 scripts/smoke-container.py` to repeat that integration test.

Native Windows and complete pairing on a native Linux host remain to be validated
in those environments. The three-OS CI matrix runs on every push and pull request;
the container job is a manual workflow dispatch. Treat the companion as preview
until native Windows/Linux checks pass.
