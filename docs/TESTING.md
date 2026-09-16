# Testing Grepleaks

Run these commands from the repository root unless a different directory is
specified. E2E scripts use Docker, disposable workspaces and a local model fixture.
They do not contact a paid model provider or run against a real pentest target.

## End-to-end checks

```bash
python3 scripts/e2e-install.py
python3 scripts/smoke-tui.py
```

The first command builds `grepleaks:local` using the real installer, redirects only
its installation destination into a temporary directory, then runs the installed
command outside the checkout. It tests a conversation with the host companion
and a separate conversation without it. Your shell profiles are not modified.
This installation E2E currently supports macOS/Linux; Windows needs a native run.

The terminal check requires **tmux**. It opens the actual Docker TUI, verifies the
Grepleaks tagline, types text without submitting it, resizes to 80×24, 160×48 and
120×38, opens/closes the command palette and checks that the text is preserved.
It uses an isolated tmux server, leaving existing sessions alone.

For a previously built image, run the conversation checks independently:

```bash
python3 scripts/smoke-container.py
python3 scripts/smoke-container.py --no-host-bridge
```

Use `--image NAME` to select another image, or `--launcher /path/to/grepleaks`
to exercise an installed command. The scenarios verify:

- Server health and rejection of missing/invalid HTTP credentials.
- Authentication to the local provider and consumption of its streamed response.
- Loopback-only published ports, a single explicit workspace mount and no privileged mode.
- Presence of the core Bun, Python, Git, nmap and ffuf executables.
- Host tool permission requests, refusal without execution and approved host execution.
- Absence of host tools when the companion is disabled.
- Approval before executing a container command that writes to the mounted workspace.
- Final model response after tool execution, workspace outputs after shutdown and container cleanup.

Builds require several gigabytes of free space, including space in Docker's VM.
The E2E installation updates the local `grepleaks:local` image tag.

## Component and regression tests

```bash
python3 -m unittest discover -s tests -v
python3 scripts/check-release.py
```

The Python tests additionally exercise malformed configuration, hidden API-key
entry in a pseudo-terminal, environment filtering, timeouts, output limits,
installer archive traversal protection and preservation of an existing command.
`check-release.py` requires Gitleaks for the full secret scan.

From `engine/packages/tui`:

```bash
bun typecheck
bun test --timeout 30000 --only-failures
```

From `engine/packages/opencode`:

```bash
bun typecheck
bun test test/provider/provider.test.ts test/provider/transform.test.ts test/plugin/loader-shared.test.ts
bun test test/permission test/auth test/session --timeout 30000 --only-failures
```

From `engine`, `bun audit --json` checks known registry advisories in the supported
workspace graph. It does not audit Kali's operating-system packages.

## Limits

These checks are a defined regression suite, not proof that every workflow works.
The fixture validates the provider protocol and tool loop, not the quality of a
real model's pentest decisions. It does not download and execute every catalog
tool, test every terminal emulator, certify host isolation or validate the custom
license. Native Windows setup, native Linux host pairing and the eventual public
GitHub download must be checked in those environments.

The manual `container` job in `.github/workflows/checks.yml` runs the installation
and terminal E2Es. The portable job runs component tests on macOS, Windows and
Linux. A configured workflow is not evidence that it has run on GitHub.

### Persistent model setup

```bash
python3 scripts/smoke-models.py
```

This macOS/Linux test uses an isolated tmux server and private temporary state. It
opens the real Docker TUI without provider environment variables, adds a custom
connection and Grepleaks, checks masked key typing and paste, switches models,
restarts the container and verifies saved connections and the selected model.
It also removes the test Grepleaks credential and checks that setup reopens while
retaining its gateway URL. No paid inference request is made. `--image` selects a
candidate image; `--dev` additionally mounts the checkout's source files.

The normal launcher now mounts its private state directory as well as any explicit
engagement workspace. Container smoke tests isolate this directory and check both
mounts. Native Windows TUI interaction still needs a Windows terminal run.

### Host artifact staging

`python3 scripts/smoke-container.py` also requests `host_stage` through the model
tool protocol, approves the transfer, reads and modifies a sample `.app` from
inside Docker, and verifies that the original outside the workspace is unchanged.
Unit tests cover independent copies, unique destinations, preserved symlinks and
rejection of recursive exchange copies. This fixture test does not validate a
real application's security or its native runtime behavior.

Generic staging coverage: all five transfer tests pass on macOS and inside the
Linux image, including standalone files of arbitrary extensions, nested source
trees, empty directories, spaces and Unicode names. The existing three-OS CI
matrix includes these tests on Windows; a native Windows run has not been
performed locally. Aikido reported no findings in the added tests.

### Default persistent workspace

The launcher now mounts its private `state/workspace` at `/engagement` when no
explicit workspace is supplied. Validation: 31 Python tests passed (one skipped
on macOS); a real Docker check wrote a report using the generated default mount,
removed the container, and verified its content in a new container and on the
host. Aikido reported no findings in the launcher and updated tests. Files outside
persistent mounts and running processes remain disposable.
