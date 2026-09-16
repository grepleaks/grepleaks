# Release checks

This tree is a publication candidate, not a validated release. Consult
`PUBLICATION_REVIEW.md` before publishing a release or image.

1. Run `python3 scripts/check-release.py` (requires Gitleaks 8.29.1). It validates
   the exact contents of reviewed false positives before running the secret scan.
   Do not blindly regenerate the baseline after a failure.
2. Run `python3 -m unittest discover -s tests -v` and the relevant engine package
   tests/typechecks using Bun 1.4.2. Do not run engine tests from its root.
3. Run `bun audit --json` in `engine/`, review the findings, and fix or explicitly
   disposition each release-relevant dependency issue. Do not claim a clean audit
   merely because another scanner misses part of the Bun monorepo.
4. Build a fresh image and test TUI input, headless execution with a local mock
   provider, authenticated server mode, workspace mounts, and companion pairing.
   Test the host companion on macOS, native Windows and Linux.
5. Review `git diff --cached`, tracked filenames, licenses and notices. The custom
   no-resale license should be reviewed by legal counsel along with ownership of
   covered contributions. Describe Grepleaks as source available and preserve
   inherited MIT/Apache notices. Rebuild release images after license changes.
   Do not publish private development folders, audit backups or engagement artifacts.
6. Create the intended GitHub repository and configure private vulnerability
   reporting, secret scanning/push protection and branch protection as appropriate.
   CI runs checks only; there is no automatic publish/deploy job in this tree.
7. After all release gates pass, create the initial commit, add the chosen remote
   and push. No GitHub repository, remote, commit identity, tag or publication is
   chosen automatically by the preparation scripts.

The local source provided for this preparation had no `.git` directory or history.
Any other remote repositories, archives, old Docker images or copies require their
own secret-history review. A clean export does not clean those other copies.
