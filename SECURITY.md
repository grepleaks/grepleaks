# Security

Grepleaks is an agent capable of executing commands, installing tools and modifying
files. Treat model output and tool suggestions as untrusted until reviewed.
Default standard configurations ask for execution and write permissions. Advanced
configurations can override that policy. A container with host files mounted
read-write can damage those files; it is not a protective boundary for them.

Never commit API keys, provider authentication, session databases, engagement data
or private reports. `.env.example` contains names only. Keep secrets in environment
variables or your own secret manager. Prompts, file contents and tool output are
sent to the model that runs your session: with your own provider key they go
directly to that provider, and with the Grepleaks key they pass through Grepleaks
to our partner abliteration.ai. Review that provider's data handling before
working with sensitive material.

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** once private vulnerability
reporting is enabled for the published repository. Do not post live keys, private
engagement data or working credentials in public issues. If that private channel is
unavailable, ask the maintainer for a private reporting channel without disclosing
the sensitive details publicly.

The repository maintainer should enable private vulnerability reporting and verify
secret scanning/push protection before opening the repository to contributions.

## Leaked credentials

Revoke/rotate a credential if it has been shared, committed or included in a
published image. Deleting a file or adding it to `.gitignore` does not revoke a key
or remove it from existing Git history, old archives, caches or Docker layers.

## Supported distribution

Security checks target the Grepleaks source/container launcher. The repository
contains only the packages the terminal product installs; upstream desktop, web
and cloud products are not part of this tree and are not deployed or supported
as Grepleaks services. No guarantee of complete vulnerability detection or safe
model behavior is made.

## Host companion preview

`--host-bridge` extends the trust boundary to the user's machine. The session token
prevents unauthenticated local requests, but the container holds that token: a
compromised container/plugin can bypass the intended TUI flow. This is not a
sandbox or a hardware-backed approval channel. Enable it only for trusted sessions.
See [the companion design](docs/HOST_COMPANION.md) before using broad host access.
