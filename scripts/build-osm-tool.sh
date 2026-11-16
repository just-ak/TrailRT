#!/usr/bin/env bash
#
# Builds trailrt-osm, the OpenStreetMap extract tool bundled beside Valhalla.
#
# It merges several regions' extracts before the tile build (Valhalla aborts
# on overlapping extracts, ADR 0018), reads an extract's data date, and pulls
# place data out for offline search (Phase 10). It replaces the osmium-tool
# executable, which is no longer bundled. ADR 0023.
#
# Built from native/trailrt-osm/ against libosmium and protozero, both
# header-only, from Homebrew. zlib and expat come from the macOS SDK, so the
# binary links system libraries only.
#
# Usage:
#   scripts/build-osm-tool.sh            # configure + build
#   scripts/build-osm-tool.sh --clean    # discard the build tree first
#
# Output: $CACHE/trailrt-osm/trailrt-osm. bundle-valhalla.sh copies it to
# resources/valhalla/bin/.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${TRAILRT_VALHALLA_CACHE:-$HOME/.cache/trailrt-valhalla}"
BUILD="$CACHE/trailrt-osm"

if ! command -v brew >/dev/null 2>&1; then
  echo "error: Homebrew is required to supply libosmium and protozero." >&2
  exit 1
fi

missing=()
for dep in libosmium protozero cmake; do
  brew list --versions "$dep" >/dev/null 2>&1 || missing+=("$dep")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "error: missing dependencies: ${missing[*]}" >&2
  echo "  brew install ${missing[*]}" >&2
  exit 1
fi

if [ "${1:-}" = "--clean" ]; then
  rm -rf "$BUILD"
fi
mkdir -p "$BUILD"

BREW="$(brew --prefix)"
echo "==> configuring trailrt-osm (libosmium $(brew list --versions libosmium | awk '{print $2}'))"
# Only libosmium and protozero on the prefix path: anything wider would let
# CMake pick Homebrew's zlib or expat over the SDK's and add dylibs to bundle.
cmake -S "$REPO/native/trailrt-osm" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="$BREW/opt/libosmium;$BREW/opt/protozero" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="${MACOS_DEPLOYMENT_TARGET:-13.3}" \
  >/dev/null

echo "==> building trailrt-osm"
cmake --build "$BUILD" -j "$(sysctl -n hw.ncpu)"

TOOL="$BUILD/trailrt-osm"
"$TOOL" version
if otool -L "$TOOL" | tail -n +2 | awk '{print $1}' | grep -qE "^(/opt/homebrew|/usr/local)"; then
  echo "error: trailrt-osm links a Homebrew library; it must use system libraries only" >&2
  otool -L "$TOOL" >&2
  exit 1
fi
echo "    tool:  $TOOL"
