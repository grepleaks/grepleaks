# Contributing

Use the Grepleaks Docker launcher for product testing and keep upstream license
notices intact.

## Repository layout

| Path | What lives there |
| :--- | :--- |
| `grepleaks`, `grepleaks.cmd`, `install.ps1` | Host launchers and the Windows installer entry point. |
| `scripts/` | Installer, launcher, database repair, container smoke test, release archive. |
| `docker/` | Image definition, entrypoint and the container configuration module. |
| `host/` | Host companion: bridge, staging and the pairing protocol. |
| `engine/` | Forked OpenCode monorepo. `packages/opencode` is the agent, `packages/tui` the terminal interface, `packages/ui` its component library; `engine/.opencode/` holds the skills, agents and tools Grepleaks ships. |
| `docs/` | Host access, host companion and licensing guides. |
| `.github/` | CI and dependency automation for this repository. The engine keeps no CI of its own. |
| `CHANGELOG.md` | Release history, one section per tag. |

The engine is built from source inside the image, so the Bun lockfiles are
committed on purpose and the image is the only build target. Release assets are
produced by `scripts/release.sh` from a tag.

Before submitting changes:

```bash
bash -n grepleaks docker/entrypoint.sh
python3 -m py_compile scripts/install.py scripts/launch.py scripts/repair-db.py scripts/smoke-container.py
```

For TUI changes, install engine dependencies with Bun 1.4.2, then run `bun typecheck`
and relevant `bun test` commands from `engine/packages/tui`, never the engine root.
Do not add API keys or real target data to tests. Avoid requests to paid providers
in automated tests. Keep public branding Grepleaks; preserve protocol identifiers
and dependency names needed for OpenCode compatibility.

By intentionally submitting original contributions to Grepleaks, you offer them
under the [Grepleaks Source Available License 1.0](LICENSE), unless a different
arrangement is explicitly agreed in writing. You retain ownership of your
contributions. Only contribute material you are entitled to license on those terms.

Inherited OpenCode code and separately licensed third-party material keep their
existing terms and notices. Identify imported material and its license in your PR;
do not claim it as an original Grepleaks contribution. In a mixed file, the
Grepleaks license applies only to original Grepleaks additions and modifications.
See [licensing](docs/LICENSING.md) and the [engine notice](engine/GREPLEAKS_LICENSE.md).
Describe behavior changes and the validation performed in your PR.
