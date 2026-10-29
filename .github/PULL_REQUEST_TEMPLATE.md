## What changes

<!-- One paragraph. Link the issue if there is one. -->

## Why

<!-- The failure or gap this closes. -->

## Validation

- [ ] `bash -n grepleaks docker/entrypoint.sh`
- [ ] `python3 -m py_compile scripts/install.py scripts/launch.py scripts/repair-db.py scripts/smoke-container.py`
- [ ] Engine changes: `bun typecheck` and the relevant `bun test` from `engine/packages/tui` or `engine/packages/opencode`
- [ ] Checked by hand: <!-- command run, screen inspected -->

## Licensing

- [ ] The change is my own work, offered under the Grepleaks Source Available License 1.0.
- [ ] Imported material is identified with its license, and upstream notices are intact.

## Notes

<!-- Anything a reviewer should know: trade-offs, follow-ups, screenshots. -->
