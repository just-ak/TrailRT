#!/usr/bin/env bash
#
# Builds the Valhalla routing engine and its N-API Node addon for bundling.
#
# TrailRT embeds Valhalla rather than talking to a routing server, so that
# snap-to-road, road classes and posted speed limits work with no network and
# nothing for the user to install. See ADR 0013.
#
# ## Why an addon and not valhalla_service
#
# Valhalla 3.9 ships N-API bindings (node-addon-api 8.5, NAPI_VERSION=8) around
# `valhalla::tyr::actor_t`, which takes the same JSON the HTTP API does. N-API
# is ABI-stable across Node and Electron — the same property ADR 0010 relies on
# for better-sqlite3 — so one `.node` file works in Electron's bundled Node
# without an Electron-specific rebuild.
#
# That makes the HTTP daemon unnecessary, which is why ENABLE_SERVICES is OFF:
# it drops prime_server, zeromq and czmq, removes a long-running child process
# and a listening socket, and removes a port to collide with.
#
# ENABLE_TOOLS stays ON because `valhalla_build_tiles` is how a user's chosen
# region becomes a routing graph. Those are one-shot CLIs, run at import time
# only, never while routing.
#
# Usage:
#   scripts/build-valhalla.sh            # configure + build
#   scripts/build-valhalla.sh --clean    # discard the build tree first
#
# Output: $CACHE/build/src/bindings/nodejs/lib/valhalla_node.node plus the
# tools in $CACHE/build. `bundle-valhalla.sh` makes them relocatable.

set -euo pipefail

# macOS 13.3, not 13.0.
#
# Valhalla uses libc++'s <format>, whose floating-point formatter calls
# std::to_chars — marked unavailable before macOS 13.3. Targeting 13.0 fails to
# compile with dozens of "'to_chars' is unavailable" errors that name the SDK
# header rather than the cause.
#
# electron-builder declares the same minimum, so the app's stated requirement
# matches what the addon can actually load. Electron 45 alone would run on
# 13.0; shipping that claim with a 13.3 addon would be a launch failure for
# anyone on 13.0 to 13.2.
VALHALLA_TAG="${VALHALLA_TAG:-3.9.1}"
CACHE="${TRAILRT_VALHALLA_CACHE:-$HOME/.cache/trailrt-valhalla}"
SRC="$CACHE/src"
BUILD="$CACHE/build"

if ! command -v brew >/dev/null 2>&1; then
  echo "error: Homebrew is required to supply Valhalla's native dependencies." >&2
  exit 1
fi

BREW="$(brew --prefix)"

# Dependencies, excluding anything only ENABLE_SERVICES would need.
DEPS=(
  boost protobuf protobuf-c sqlite libspatialite luajit geos lz4
  libgeotiff libtiff openssl@3 expat curl cmake pkgconf
  # ENABLE_TOOLS builds tz.sqlite, which shells out to the spatialite CLIs.
  # CMake checks for the executables, not the library, so the library alone is
  # not enough and the error it gives names neither package.
  spatialite-tools
  # Not a Valhalla dependency: bundle-valhalla.sh ships its `osmium` beside the
  # Valhalla tools, to merge several regions into one extract before building.
  # Valhalla aborts on overlapping extracts. ADR 0018.
  osmium-tool
)

missing=()
for dep in "${DEPS[@]}"; do
  brew list --versions "$dep" >/dev/null 2>&1 || missing+=("$dep")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "error: missing dependencies: ${missing[*]}" >&2
  echo "  brew install ${missing[*]}" >&2
  exit 1
fi

if [ ! -d "$SRC/.git" ]; then
  echo "==> cloning Valhalla $VALHALLA_TAG"
  mkdir -p "$(dirname "$SRC")"
  git clone --branch "$VALHALLA_TAG" --depth 1 \
    --recurse-submodules --shallow-submodules \
    https://github.com/valhalla/valhalla.git "$SRC"
fi

if [ "${1:-}" = "--clean" ]; then
  echo "==> clearing $BUILD"
  rm -rf "$BUILD"
fi
mkdir -p "$BUILD"

# ---------------------------------------------------------------- dependency paths
#
# Several of these are keg-only, so Homebrew leaves no `opt/<name>/include`
# symlink and CMake's own search paths miss them. Resolving through the Cellar
# is what makes the build reproducible on a machine where they are not linked
# into the prefix.
cellar_prefix() {
  local name="$1" cellar
  cellar="$(brew --cellar "$name" 2>/dev/null)" || return 1
  local version
  version="$(ls "$cellar" 2>/dev/null | head -1)"
  [ -n "$version" ] && echo "$cellar/$version"
}

SQLITE_PREFIX="$(cellar_prefix sqlite)"
if [ ! -f "$SQLITE_PREFIX/include/sqlite3.h" ]; then
  echo "error: sqlite3.h not found under $SQLITE_PREFIX" >&2
  exit 1
fi

pc_paths=()
for name in expat openssl@3 curl sqlite luajit libspatialite geos libgeotiff lz4; do
  p="$(cellar_prefix "$name" || true)"
  [ -n "${p:-}" ] && [ -d "$p/lib/pkgconfig" ] && pc_paths+=("$p/lib/pkgconfig")
  [ -d "$BREW/opt/$name/lib/pkgconfig" ] && pc_paths+=("$BREW/opt/$name/lib/pkgconfig")
done
pc_paths+=("$BREW/lib/pkgconfig" "$BREW/share/pkgconfig")

cm_paths=("$BREW")
for name in expat openssl@3 curl luajit; do
  [ -d "$BREW/opt/$name" ] && cm_paths+=("$BREW/opt/$name")
done

join_by() { local IFS="$1"; shift; echo "$*"; }
export PKG_CONFIG_PATH="$(join_by : "${pc_paths[@]}")"
export CMAKE_PREFIX_PATH="$(join_by : "${cm_paths[@]}")"

echo "==> configuring (Valhalla $VALHALLA_TAG)"
cmake -S "$SRC" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DENABLE_NODE_BINDINGS=ON \
  -DENABLE_PYTHON_BINDINGS=OFF \
  -DENABLE_SERVICES=OFF \
  -DENABLE_TOOLS=ON \
  -DENABLE_HTTP=ON \
  -DENABLE_TESTS=OFF \
  -DENABLE_BENCHMARKS=OFF \
  -DENABLE_CCACHE=OFF \
  -DSQLITE_ROOT_DIR="$SQLITE_PREFIX" \
  -DSQLite3_INCLUDE_DIR="$SQLITE_PREFIX/include" \
  -DSQLite3_LIBRARY="$SQLITE_PREFIX/lib/libsqlite3.dylib" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="${MACOS_DEPLOYMENT_TARGET:-13.3}"

echo "==> building with $(sysctl -n hw.ncpu) jobs"
cmake --build "$BUILD" -j "$(sysctl -n hw.ncpu)"

ADDON="$BUILD/src/bindings/nodejs/lib/valhalla_node.node"
if [ ! -f "$ADDON" ]; then
  echo "error: expected addon at $ADDON" >&2
  exit 1
fi

echo
echo "==> built"
echo "    addon: $ADDON"
file "$ADDON" | sed 's/^/    /'
for tool in valhalla_build_tiles valhalla_build_admins valhalla_build_timezones; do
  found="$(find "$BUILD" -maxdepth 3 -name "$tool" -type f -perm -u+x 2>/dev/null | head -1)"
  [ -n "$found" ] && echo "    tool:  $found"
done
