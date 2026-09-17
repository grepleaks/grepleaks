# Install Grepleaks

## Requirements

- A working Docker daemon with Linux containers.
- Python 3.10+ on the host (`python3` on macOS/Linux; `py -3` on Windows). No third-party Python packages are needed.
- About **4 GB** of free disk space. The sources are a ~40 MB download; the first
  install builds the local Docker image (~3 GB: Debian base, core toolkit, Bun
  runtime and engine dependencies). Check `docker system df` and available
  host/VM disk space.
- Internet access for image construction, provider calls and on-demand tool installs.
- An API key, base URL and model ID from your OpenAI-compatible provider.

On macOS use Docker Desktop or Colima. On Linux use Docker Engine or Docker Desktop.
On Windows use Docker Desktop and `grepleaks.cmd` from cmd/PowerShell. WSL2 can also
run the Bash wrapper, but a companion started in WSL executes inside WSL, not on
the native Windows host. Use the Windows launcher for Windows host commands.

## Install the user command

From the downloaded repository, on macOS/Linux (Bash or Zsh):

```bash
python3 scripts/install.py --source . && export PATH="$HOME/.local/bin:$PATH"
```

On Windows, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
$env:Path = "$env:LOCALAPPDATA\Grepleaks\bin;$env:Path"
```

Then run `grepleaks` from any directory. Docker must be running. Provider setup
works as described below. No automatic host access is enabled by installation.
On Fish, use `python3 scripts/install.py --source .; and fish_add_path "$HOME/.local/bin"`.

The installer checks Docker, builds `grepleaks:local`, then installs the small host
runtime in `~/.local/share/grepleaks` (macOS/Linux) or `%LOCALAPPDATA%\Grepleaks`
(Windows). It never copies your provider settings, `.env`, engagements or local
dependencies. Unix shell configuration gets a PATH entry; Windows gets a user PATH
entry. No system-wide Python or administrator installation is performed.

Run the installer again to update. A failed build leaves the installed command
untouched. Previous small host runtime directories remain available on disk.
The downloaded checkout can be removed afterwards. For `--dev`, keep a checkout
and use its `./grepleaks` / `.\grepleaks.cmd` launcher instead.

### Download and install in one command

macOS/Linux (Bash/Zsh):

```bash
(set -o pipefail; curl -fsSL https://raw.githubusercontent.com/grepleaks/grepleaks/main/scripts/install.py | python3 - --repository grepleaks/grepleaks) && export PATH="$HOME/.local/bin:$PATH"
```

Windows PowerShell:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod https://raw.githubusercontent.com/grepleaks/grepleaks/main/install.ps1))) -Repository grepleaks/grepleaks
```

Both install from the repository and build locally; no prebuilt registry image is
required. Docker and Python must already be installed. You can download and inspect
the installer before running it instead of executing the download directly.
To pin a version, replace `main` with a release tag or commit in both places of
the command.

### Uninstall

On macOS/Linux, remove `~/.local/bin/grepleaks`, `~/.local/share/grepleaks` and the
marked Grepleaks PATH entries in your shell configuration. On Windows, remove
`%LOCALAPPDATA%\Grepleaks` and its `bin` entry from your **user** PATH. Optionally
remove the dedicated image with `docker image rm grepleaks:local`. Engagement
folders you created elsewhere are independent of the installation. Saved settings,
credentials and sessions remain in `~/.grepleaks/state`; remove that directory only
if you also want to erase your saved Grepleaks data.

## Manual build and authenticate

```bash
docker build -f docker/Dockerfile -t grepleaks:local .
```

Run `./grepleaks` (or `grepleaks` after installation). On first launch the TUI
opens **Models**. Choose **Grepleaks AI** or **+ Add model** to connect an
OpenAI-compatible API with its display name, base URL, exact model ID and API key.
Use `/models` to switch models later. The **Configure** action edits the selected
connection. Grepleaks AI remains available in the list even before it is connected.
For Grepleaks, `GREPLEAKS_API_URL` supplies the default endpoint; otherwise the TUI
asks for it. No public gateway address is assumed.

Settings, credentials, selected model and sessions persist in `~/.grepleaks/state`
(`%USERPROFILE%\.grepleaks\state` on Windows), mounted at `/var/lib/grepleaks`.
`GREPLEAKS_STATE_DIR` selects a different private directory. API keys are stored in
`data/opencode/auth.json`, separately from model configuration, with owner-only
file permissions on POSIX. They are not encrypted at rest. Keep this directory out
of projects, Git and shared backups. API-key input is hidden in the TUI.

Existing complete `BYOK_API_KEY`, `BYOK_BASE_URL`, `BYOK_MODEL` or managed environment
settings are imported into this store at startup. Explicit environment settings
take precedence on that launch; unset them afterwards to use the model selected in
`/models`. Keys are forwarded by environment variable name, not command-line value.
Docker administrators can inspect container environments and the persistent store.
Incomplete environment configurations are rejected. A keyless launch opens setup;
noninteractive model calls require a saved connection or complete environment setup.

In Windows PowerShell:

```powershell
$env:BYOK_BASE_URL = "https://your-provider.example/v1"
$env:BYOK_MODEL = "your-model-id"
$env:BYOK_API_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "Provider API key" -AsSecureString)).Password
.\grepleaks.cmd --host-bridge
```

To verify the image without a provider key or paid request:

```bash
python3 scripts/smoke-container.py
```

On Windows replace `python3` with `py -3`. This explicit test starts a temporary
local model stub and requests a harmless host command that writes and prints a
random marker inside the temporary workspace.
It verifies the permission gate before approving that test command, then removes
its container and temporary workspace.

A managed gateway is optional and requires both `GREPLEAKS_API_KEY` and an explicit
`GREPLEAKS_API_URL`. This project does not provision or promise a hosted gateway.
`OPENCODE_CONFIG_CONTENT` accepts an advanced JSON object; it is an explicit override
and may alter the default permission policy. Never share configuration containing
real credentials.

## Host companion

`grepleaks` automatically starts and pairs its host companion on macOS, Windows
and Linux. No setup flag is required. It runs as the account launching Grepleaks;
it does not elevate to administrator/root or bypass operating-system permissions.
Host commands use the existing approval prompts. Use `--no-host-bridge` to disable
this access, or `--host-bridge` as an explicit equivalent of the default.
The optional `/host` mount (`--host-access`) is independent of the companion.

## Files and local development

`./grepleaks --workspace /path/to/engagement` mounts that directory at `/engagement`
read-write. It must exist. `--host-access` additionally mounts the home directory,
or `GREPLEAKS_HOST_ROOT`, at `/host`. See [host access](docs/HOST_ACCESS.md).

`./grepleaks --dev --workspace /path/to/engagement` loads local engine source while
retaining the image's Linux dependencies. Restart after source edits. Rebuild after
changing dependencies, manifests, the Dockerfile, or files outside mounted source.

## Headless commands

```bash
./grepleaks --workspace "$PWD/engagements" run "Review the provided scope file"
```

For the HTTP API, export a strong `OPENCODE_SERVER_PASSWORD` and optionally
`OPENCODE_SERVER_USERNAME` (upstream default: `opencode`), then:

```bash
./grepleaks serve
```

The launcher publishes `127.0.0.1:4096` only. `GREPLEAKS_PORT` changes the host port.
Do not expose this execution API to the internet. The entrypoint also refuses
server mode without authentication when invoked directly with Docker.

## Troubleshooting

- Mount rejected: the directory must be shared with Docker's daemon or Linux VM.
- Host service unreachable: use `host.docker.internal`, check its bind address and
  firewall; container `localhost` refers to the container.
- EIO/no space during build: check both host storage and Docker VM storage. Do not
  delete volumes or unrelated applications as an automatic troubleshooting step.
- Dependency changes: rerun the build. Bun is pinned to 1.4.2 and the lockfile is frozen.

## Persistent work files

The launcher always mounts `/engagement` from the host. Without `--workspace`,
it uses `~/.grepleaks/state/workspace` (or `GREPLEAKS_STATE_DIR/workspace`).
An explicit `--workspace /path` overrides this default. Reports, evidence and
scripts saved there survive container removal. The agent is instructed to keep
durable work in this directory, grouped by engagement. `/tmp` and other paths
outside persistent mounts remain ephemeral; installed system tools and running
processes are not restored. Older containers must have their files copied out
before closing them; the new mount cannot retroactively preserve removed files.
