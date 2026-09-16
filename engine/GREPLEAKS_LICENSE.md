# Licensing within the Grepleaks engine fork

This directory contains material under different licenses. The unchanged
[OpenCode MIT license](LICENSE) covers the inherited OpenCode material. It does
not offer new Grepleaks contributions under MIT.

Original Grepleaks additions and modifications are offered under the
[Grepleaks Source Available License 1.0](../LICENSE). In a mixed file, this applies
only to copyrightable Grepleaks contributions; original upstream portions keep
their original terms. A change of license notice does not revoke any rights
already granted by another license.

The Grepleaks additions include its host companion plugin
(`packages/opencode/src/plugin/grepleaks-host.ts`), persona
(`AGENTS.grepleaks.md`), and the original implementation of its terminal branding,
background, pentest catalog UI and animated prompt suggestions. Their principal
implementation paths include:

- `packages/tui/src/component/beams-background.tsx`
- `packages/tui/src/component/brand-art.ts`
- `packages/tui/src/feature-plugins/sidebar/pentest-tools.tsx`
- `packages/tui/src/prompt/typewriter.ts`
- Grepleaks-specific changes to the home screen, prompt, theme, footer and session
  permission view, and to the CLI branding.

This list identifies features; it does not relicense third-party code, facts,
reference text, fonts or other incorporated material. The generated catalog
retains any applicable rights and notices of its source reference material.
Dependencies, bundled skills and their existing MIT/Apache notices remain separate.
See [third-party notices](../THIRD_PARTY_NOTICES.md).

The package license metadata points to these notices because the fork is no
longer accurately described by a blanket MIT license. The private packages are
not separate npm publications; keep the root license and upstream notices with
any permitted distribution of this fork.
