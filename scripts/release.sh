#!/usr/bin/env bash
# Build the verified source archive and checksum for a GitHub release.
set -euo pipefail
tag="${1:?usage: scripts/release.sh vX.Y.Z [output-dir]}"
version="${tag#v}"
out="${2:-dist}"
mkdir -p "$out"
archive="$out/grepleaks-$version.tar.gz"
git archive --format=tar.gz --prefix="grepleaks-$version/" "$tag" -o "$archive"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$out" && sha256sum "grepleaks-$version.tar.gz" > SHA256SUMS)
else
  (cd "$out" && shasum -a 256 "grepleaks-$version.tar.gz" > SHA256SUMS)
fi
echo "Created $archive and $out/SHA256SUMS"
echo "Upload both to the GitHub release for $tag."
