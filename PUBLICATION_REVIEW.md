# Publication review — 2026-09-15

**Status: local installation and execution validated on macOS/Colima. Source
candidate prepared for review; not a certification of every platform or component.**

## Completed

- Prepared a separate source export. Personal provider configs, the old Go binary,
  local development targets, experimental scanner, dependencies and audit backups
  are excluded. The original private checkout was not rewritten.
- Public launcher, image paths, persona, README and terminal branding use Grepleaks.
  Upstream namespaces, schemas, third-party service names and copyright notices
  remain intentional compatibility and attribution references.
- Removed the private credential fallback. Standard runtime configuration uses
  environment references and restrictive file permissions. Missing provider settings
  are requested interactively before Docker starts; key input is hidden and remains
  session-only. Automated launches fail early with the missing variable names.
- Host mounts remain explicit. The optional companion pairs automatically using a
  session credential, and approved host commands execute outside Docker. Advanced
  configuration also preserves the requested companion plugin.
- Server mode requires authentication and publishes only on host loopback.
- Added license notices, contribution/security guidance, portable tests, secret
  checks, engine CI and a repeatable container smoke test with a local model stub.

## Dependency audit

The supported terminal installation now selects 15 workspaces rather than the
entire upstream web, desktop and cloud monorepo. Unused product sources remain for
reference but are excluded from this workspace graph and from the Docker image.
Their separate lockfiles are not covered by the terminal runtime audit and must
be independently updated before anyone enables those products.

Compatible security updates and targeted overrides were applied to the supported
lockfile. The initial 276 advisory entries were reduced to **zero entries reported
by `bun audit --json` on 2026-09-11**. This includes development dependencies in the
selected graph. No advisory IDs were ignored to obtain that result.

Overrides align AI SDK provider/types, Babel, OpenTelemetry, Seroval and WebSocket
packages. The old Undici 5 consumers use patched Undici 6; newer major consumers
keep their own versions. YAML and esbuild overrides are scoped to affected
consumers/ranges. See `engine/package.json` and `engine/bun.lock` for exact versions.
Bun 1.4.2 supports these [scoped overrides](https://bun.com/docs/pm/overrides).

This is an npm advisory check, not proof of absence of vulnerabilities. It does not
certify Kali packages, bundled pentest tools, arbitrary tools installed later, or
unknown vulnerabilities. Kali is not listed in Trivy's [supported OS coverage](https://trivy.dev/docs/latest/guide/coverage/os/);
an empty scanner result must not be presented as a complete Kali security audit.
The Kali rolling base and apt repository are not immutable release snapshots.

## Validation performed

### Agent instructions — 2026-09-15

- Standard configuration now selects a penetration-testing expert persona for
  the main `build` agent instead of its provider's default coding-assistant prompt.
  Explicit advanced configurations retain their own agent settings.
- The mission instructions specify catalog/skill lookup, availability checks,
  installation only when needed, evidence-based execution and removal of tools
  added for the task once no longer needed. Preinstalled software, shared binaries
  and evidence are preserved. The routing skill's contradictory preinstallation
  claims and routine autoremove commands were corrected.
- Arbitrary phase ordering and response-length constraints are replaced by
  mission-driven investigation and short explanations before/after each action.
  Runtime permissions and established authorization remain in force.
- Python tests: **25 passed, 1 Windows-only test skipped**. The Docker smoke test
  passed with the updated prompt and skill. Its local provider fixture checks the
  actual outbound system messages for the expert identity, action explanations,
  skill discovery and ownership-aware cleanup, and rejects the old generic
  OpenCode identity. This validates delivery, not a real model's obedience.
- Local image `grepleaks:local` now points to `fda6bfe45694`, an update layer over
  the previously validated image containing only the changed runtime config,
  mission instructions and routing skill. A full Dockerfile build includes the
  same source changes. Existing running containers must be restarted.
- Aikido scanned the five changed source/test files without remaining findings.
  Its separate validation-Dockerfile scan flagged inherited root execution
  (`CKV_DOCKER_3`, severity 65, lines 1–6). This existing design supports package
  installation inside Kali; it is retained and is not a claim of host isolation.
  Test assertions were changed to explicit exceptions so optimized Python cannot
  silently disable the smoke checks. Gitleaks/release structure checks passed.

### Expanded regression run — 2026-09-12

- Complete TUI suite: **202 passed, 1 skipped**, 8 snapshots and 8,982 assertions.
  Two expectations still used the upstream `opencode` command name; they now
  expect `grepleaks`. The keymap mode test now explicitly supplies its model
  shortcut instead of assuming the upstream default that Grepleaks disables.
- Provider/plugin tests: **691 passed**, 1,589 assertions.
- Session/authentication/permission tests: **523 passed, 7 skipped, 1 todo**,
  1,314 assertions. Skipped/todo cases are not counted as verified.
- Python tests: **24 passed, 1 native Windows test skipped**, both on macOS and
  inside Linux/ARM64. The launcher now forwards engine flags such as `-s`,
  `--model` and `--continue`; a subprocess regression test covers this fix.
- Real Docker TUI: tagline, text input, 80×24 / 160×48 / 120×38 resizing,
  command palette open/close and preservation of unsent input passed in tmux.
- Registry dependency audit returned `{}` on 2026-09-12. Release structure and
  Gitleaks checks passed. Earlier sandbox failures were rerun with the local
  server/filesystem access needed by the tests; they are not counted as passes.
- The image was rebuilt as `grepleaks:local` (`2dd17c35debd`) with the frozen
  dependency lockfile. All six license/notices SHA-256 hashes match the source.
- The complete `scripts/e2e-install.py` run passed: actual image build and
  per-user installation into a temporary path containing spaces, PATH command
  lookup outside the checkout, engine `--version` forwarding, conversations with
  and without the companion, denied and approved host actions, approved container
  command execution, persisted workspace outputs and container cleanup. HTTP
  authentication, provider credentials, loopback-only ports, explicit mounts and
  the presence of core tools were checked against the running Docker containers.
- One sequential installed-command run timed out waiting for server health in
  the no-companion scenario, although the server logged its listening address.
  The same scenario passed separately and in the subsequent complete installation
  run. The cause has not been established;
  do not treat this run as proof that startup is free of intermittent failures.

See [Testing](docs/TESTING.md) for repeatable commands and coverage limits.

### Earlier validation

- `bun install` completed from a fresh local dependency tree; the Docker build
  completed with `bun install --frozen-lockfile` and Bun 1.4.2.
- Engine and TUI package TypeScript checks passed on the patched dependencies.
- Provider/plugin regression tests: **691 passed**, 1,589 assertions.
- TUI regression tests: **3 passed**, 55 assertions, covering branding/resizing,
  catalog clicks and placeholder/input separation.
- Python launcher/companion tests: **18 passed on macOS and 18 under Linux**,
  including provider setup before Docker and masked key entry in a real pseudo-terminal.
- Docker smoke test passed: server startup, rejection of unauthenticated access,
  session creation, local provider streaming, host permission request, approval
  and actual host execution. The test checks that its temporary host marker file
  does not exist before approval and does exist after execution.
- The real container TUI was opened in a terminal, resized from 120×38 to 80×24,
  and accepted text without submitting it to a provider.
- Gitleaks passes with 55 reviewed non-secret fingerprints guarded by exact file
  hashes. No source directory is blanket-exempted. Structural release checks pass.
- No paid provider or real pentest target was used for these tests.

## Remaining validation and publication steps

- Native Windows execution and complete pairing on a native Linux Docker host
  still require those environments. The CI configuration is prepared, but has not
  been executed on GitHub. macOS/Colima pairing and Linux component tests are the
  environments actually exercised locally.
- The companion permission UI is an application control, not a host sandbox or a
  protection against a compromised container that obtains its pairing credential.
  See `docs/HOST_COMPANION.md` for the supported trust model.
- The owner selected professional use with no resale or paid hosted versions.
  Original Grepleaks material now uses the custom Grepleaks Source Available
  License 1.0; inherited MIT/Apache rights and notices remain in place. Have legal
  counsel review this custom text and the provenance of covered contributions
  before publication; see `docs/LICENSING.md`.
- The latest rebuilt image and its license checks are recorded in the expanded
  validation section above.
- Create/select the intended GitHub repository and enable private vulnerability
  reporting and secret scanning. No remote, push, release or publication has been
  performed by these preparation scripts.
- A per-user installer now builds the image and installs a standalone `grepleaks`
  command, with Unix shell PATH setup and a Windows PowerShell bootstrap. Local
  validation: 24 Python tests passed, one native Windows installer test skipped.
  The installed Unix command was executed outside the checkout from a path with
  spaces; failed-build preservation and archive traversal rejection were checked.
  Native Windows installation and the live GitHub download remain unverified;
  download commands in INSTALL.md are explicitly marked repository templates.
- Only the supplied source export was secret-audited. Other copies, previous
  images, archives and unknown remote history require their own review.

### Persistent model configuration (2026-09-15)

Restored `/models` with an Add model entry, an always-present Grepleaks entry, and
only explicitly configured models. OpenAI-compatible connections are configured
inside the TUI; credentials use the engine auth store, separately from settings.
The launcher persists config, credentials, selection and sessions under the user's
`.grepleaks/state` directory; explicit environment provider settings are imported.
The directory is mounted read-write at `/var/lib/grepleaks`; this is a deliberate
addition to the previous workspace-only mount policy. API keys are not encrypted
at rest and must stay outside published files. POSIX modes restrict the store;
native Windows ACLs and terminal interaction have not been independently tested.

The interactive flow uses an explicit gateway URL or GREPLEAKS_API_URL. This does
not provision a hosted Grepleaks gateway, billing service or user accounts. Saving
a connection does not validate its credentials with a real provider; the first
inference request will report provider authentication/model errors.

Validation: 208 TUI tests passed (1 skipped), TypeScript passed, 25 Python tests
passed (1 Windows-only fixture skipped on macOS). Real Docker model setup passed
with typed and pasted masked keys, two connections, persisted selection, restart
and missing Grepleaks key recovery. The authenticated container/host-companion
smoke also passed. Aikido reported no issues on the changed source and test files.
The tested image `7d200f5215bb` is tagged `grepleaks:local`.

### Default host companion (2026-09-15)

The launcher now enables the host companion by default. `--no-host-bridge` opts
out; `--host-bridge` remains compatible. The companion uses the launching user's
existing privileges, fresh per-session credentials and a loopback-only broker.
Host command approval remains enforced; no admin elevation or broad host mount
was added. Help/version queries do not start a companion. Agent instructions now
distinguish host_info/host_run availability from the optional /host mount flag.

Validation: all 17 launcher/configuration tests passed. Both real Docker smoke
scenarios passed: default host execution with rejection/approval checks, and
explicit `--no-host-bridge` with host tools absent. Aikido reported no issues in
the changed Python files. Image `a2f7aad2473e` is tagged `grepleaks:local`.

### Container-first host artifact analysis (2026-09-15)

Added `host_stage` and a portable host copy helper shipped by the installer. The
agent is instructed to stage a selected host application/file in the shared state
exchange, use container tools for static analysis and reserve native runtime work
for the appropriate host OS. Originals remain untouched; symlinks are preserved
without following their targets. Copies persist; this is not a forensic clone.

Validation: 29 Python tests passed, one Windows-only test skipped on macOS;
OpenCode TypeScript check passed. Real Docker E2E passed for permission-gated
transfer of a sample `.app` outside the workspace, reading and modifying the
copy inside Docker, and verifying the original remained unchanged. No real app
was audited. The explicit no-companion Docker regression also passed.
Image `142ade98398f` is now tagged `grepleaks:local`.

Aikido found no issues in the new transfer helper, plugin or other changed files
except two existing installer path alerts at `pending.write_text(content)` and
`config.write_text(...)`. These were reviewed: destinations are the installing
user's fixed launcher/fish configuration paths; no artifact path or remotely
supplied destination controls either write. The installer change only adds the
new helper to its runtime file list. Native Windows transfer remains untested.
