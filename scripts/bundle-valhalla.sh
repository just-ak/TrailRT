#!/usr/bin/env bash
#
# Makes the built Valhalla addon and tools relocatable, ready to ship inside
# the .app bundle.
#
# A Homebrew-built binary records its dependencies as absolute paths like
# /opt/homebrew/opt/geos/lib/libgeos.dylib. Those do not exist on a user's
# machine, so the addon fails to load with a dlopen error naming a path nobody
# outside this project has. This script collects the whole transitive closure
# and rewrites every reference to be relative to the loading binary.
#
# ## Why @loader_path and not @executable_path
#
# `dylibbundler` and most tutorials rewrite to @executable_path, which resolves
# against the *running executable*. For a `.node` loaded by Electron that is
# Electron's own binary several directories away, so the libraries would be
# looked for in the wrong place. @loader_path resolves against the binary doing
# the loading — the addon itself — which is what we need, and it is also why
# the tools get a different rpath from the addon: they sit one level deeper.
#
# ## Layout produced
#
#   resources/valhalla/
#     valhalla_node.node      rpath -> @loader_path/lib
#     bin/valhalla_build_*    rpath -> @loader_path/../lib
#     lib/*.dylib             id @rpath/<name>, rpath -> @loader_path
#
# Every dylib also gets @loader_path on its own rpath so the libraries can find
# each other inside lib/ without knowing who loaded them.
#
# Re-signing at the end is not optional: install_name_tool invalidates an
# existing code signature, and macOS refuses to load a dylib whose signature no
# longer matches. Ad-hoc is enough here for the same reason it is enough for the
# app (ADR 0009).
#
# Usage: scripts/bundle-valhalla.sh

set -euo pipefail

CACHE="${TRAILRT_VALHALLA_CACHE:-$HOME/.cache/trailrt-valhalla}"
BUILD="$CACHE/build"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BREW="$(brew --prefix)"
OUT="$REPO/resources/valhalla"

ADDON_SRC="$BUILD/src/bindings/nodejs/lib/valhalla_node.node"

# Only the tools a user's machine actually needs. The build produces a couple of
# dozen; shipping transit ingestion and benchmarking tools would be dead weight.
TOOLS=(valhalla_build_tiles valhalla_build_admins valhalla_build_timezones valhalla_build_config)

if [ ! -f "$ADDON_SRC" ]; then
  echo "error: addon not built. Run scripts/build-valhalla.sh first." >&2
  exit 1
fi

echo "==> preparing $OUT"
rm -rf "$OUT"
mkdir -p "$OUT/lib" "$OUT/bin"

cp "$ADDON_SRC" "$OUT/valhalla_node.node"
for tool in "${TOOLS[@]}"; do
  found="$(find "$BUILD" -maxdepth 3 -name "$tool" -type f 2>/dev/null | head -1)"
  if [ -z "$found" ]; then
    echo "warning: tool not found, skipping: $tool" >&2
    continue
  fi
  cp "$found" "$OUT/bin/$tool"
done
chmod u+w "$OUT/valhalla_node.node" "$OUT/bin/"* 2>/dev/null || true

# ------------------------------------------------- config template
#
# Generated here, at build time, rather than hand-written at runtime. Valhalla's
# config has a large surface with defaults that affect costing, and inventing a
# minimal one by hand produces subtly wrong behaviour that nothing warns about.
# The runtime copy only substitutes the tile directory — see
# main/routing/embedded.ts.
#
# valhalla_build_config is a Python script using 3.10+ syntax, and the default
# python3 on macOS is Xcode's 3.9, which fails with a confusing TypeError about
# `|` on a GenericAlias. Pick a new enough interpreter explicitly.
echo "==> generating config template"
PYBIN=""
for candidate in "$BREW/opt/python@3.13/bin/python3.13" "$BREW/opt/python@3.12/bin/python3.12" python3.13 python3.12; do
  if command -v "$candidate" >/dev/null 2>&1; then PYBIN="$candidate"; break; fi
done
if [ -z "$PYBIN" ]; then
  echo "error: need Python 3.12+ for valhalla_build_config (found $(python3 --version 2>&1))" >&2
  exit 1
fi
"$PYBIN" "$BUILD/valhalla_build_config" \
  --mjolnir-tile-dir /PLACEHOLDER/tiles \
  > "$OUT/config.template.json"
python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$OUT/config.template.json" \
  || { echo "error: generated config is not valid JSON" >&2; exit 1; }
echo "  $(wc -c < "$OUT/config.template.json" | tr -d ' ') bytes"

# ------------------------------------------------------- collect the closure
#
# Breadth-first over otool output. System libraries under /usr/lib and
# /System are deliberately left alone: they are present on every macOS and
# copying them would be both pointless and, for some, not redistributable.
echo "==> collecting dependencies"
python3 - "$OUT" "$(brew --prefix)" <<'PY'
import os, re, shutil, subprocess, sys

out, brew_prefix = sys.argv[1], sys.argv[2]
lib_dir = os.path.join(out, 'lib')

def otool(flag, binary):
    try:
        return subprocess.run(['otool', flag, binary], capture_output=True,
                              text=True, timeout=30).stdout
    except Exception:
        return ''

def deps(binary):
    out_lines = otool('-L', binary).splitlines()[1:]
    return [m.group(1) for m in (re.match(r'\s+(\S+)', l) for l in out_lines) if m]

def rpaths(binary):
    found, pending = [], False
    for line in otool('-l', binary).splitlines():
        if 'LC_RPATH' in line:
            pending = True
        elif pending and 'path ' in line:
            found.append(line.split('path ', 1)[1].split(' (')[0].strip())
            pending = False
    return found

def is_third_party(path):
    return path.startswith((brew_prefix, '/usr/local')) and not path.startswith('/usr/lib')

# Lazily indexed basename -> absolute path across the Homebrew prefix. Needed
# because a Homebrew library may reference a sibling as @rpath/<name>, which
# carries no directory to search.
_index = None
def search_prefix(name):
    global _index
    if _index is None:
        _index = {}
        for root in (os.path.join(brew_prefix, 'opt'), os.path.join(brew_prefix, 'lib'),
                     os.path.join(brew_prefix, 'Cellar')):
            for dirpath, _dirnames, filenames in os.walk(root, followlinks=True):
                if not dirpath.endswith('/lib') and '/lib/' not in dirpath:
                    continue
                for fn in filenames:
                    if fn.endswith('.dylib'):
                        _index.setdefault(fn, os.path.join(dirpath, fn))
    return _index.get(name)

def resolve(dep, origin):
    """Turns a recorded dependency into an absolute path on this machine.

    Homebrew libraries mix absolute paths with @rpath and @loader_path, and the
    relative forms are the ones that bite: an @rpath reference looks like
    nothing to copy, so skipping it silently produces a bundle that passes a
    path audit and then fails to load.
    """
    if dep.startswith('@loader_path/'):
        return os.path.normpath(os.path.join(os.path.dirname(origin), dep[len('@loader_path/'):]))
    if dep.startswith('@rpath/'):
        tail = dep[len('@rpath/'):]
        for rp in rpaths(origin):
            base = (os.path.dirname(origin) if rp.startswith('@loader_path')
                    else rp if os.path.isabs(rp) else None)
            if base is None:
                continue
            suffix = rp.replace('@loader_path', '').lstrip('/')
            candidate = os.path.normpath(os.path.join(base, suffix, tail))
            if os.path.exists(candidate):
                return candidate
        sibling = os.path.join(os.path.dirname(origin), tail)
        if os.path.exists(sibling):
            return sibling
        return search_prefix(os.path.basename(tail))
    if dep.startswith('@executable_path/'):
        return None
    return dep

roots = [os.path.join(out, 'valhalla_node.node')]
bin_dir = os.path.join(out, 'bin')
if os.path.isdir(bin_dir):
    roots += [os.path.join(bin_dir, f) for f in os.listdir(bin_dir)]

# Each queue entry pairs the binary to scan with the original location it came
# from, because relative references must be resolved against where the library
# lived on this machine, not where it has just been copied to.
collected = {}
queue = [(r, r) for r in roots]
seen = set()

while queue:
    current, origin = queue.pop()
    if current in seen:
        continue
    seen.add(current)
    for dep in deps(current):
        resolved = resolve(dep, origin)
        if resolved is None or not is_third_party(resolved):
            continue
        name = os.path.basename(resolved)
        if name in collected:
            continue
        if not os.path.exists(resolved):
            print(f'  warning: unresolved {dep} (from {os.path.basename(origin)})',
                  file=sys.stderr)
            continue
        collected[name] = resolved
        target = os.path.join(lib_dir, name)
        shutil.copy2(resolved, target)
        os.chmod(target, 0o755)
        queue.append((target, resolved))

print(f'  copied {len(collected)} libraries')
size = sum(os.path.getsize(os.path.join(lib_dir, n)) for n in collected)
print(f'  size   {size / 1048576:.1f} MB')
PY

# ------------------------------------------------------------- rewrite paths
echo "==> rewriting install names"
rewrite() {
  local binary="$1" rpath="$2"
  chmod u+w "$binary"

  # Point every third-party reference at @rpath/<basename>, leaving system
  # libraries untouched.
  #
  # @loader_path references are rewritten too. They were correct in Homebrew's
  # directory layout and are wrong in ours — everything now lives flat in
  # lib/ — so leaving them would point outside the bundle. Existing @rpath
  # references need no change: they already resolve through the rpath added
  # below.
  otool -L "$binary" | tail -n +2 | awk '{print $1}' | while read -r dep; do
    case "$dep" in
      /opt/homebrew/*|/usr/local/*|@loader_path/*)
        install_name_tool -change "$dep" "@rpath/$(basename "$dep")" "$binary" 2>/dev/null || true
        ;;
    esac
  done

  # A stale LC_RPATH from the build tree would be searched first and could
  # resolve to a Homebrew copy on a developer machine, hiding a packaging bug
  # that only shows up for users.
  otool -l "$binary" | awk '/LC_RPATH/{f=1} f&&/path /{print $2; f=0}' | while read -r old; do
    case "$old" in
      /opt/homebrew/*|/usr/local/*|"$HOME"/*)
        install_name_tool -delete_rpath "$old" "$binary" 2>/dev/null || true
        ;;
    esac
  done

  install_name_tool -add_rpath "$rpath" "$binary" 2>/dev/null || true
}

for dylib in "$OUT/lib/"*.dylib; do
  [ -e "$dylib" ] || continue
  install_name_tool -id "@rpath/$(basename "$dylib")" "$dylib" 2>/dev/null || true
  rewrite "$dylib" "@loader_path"
done

rewrite "$OUT/valhalla_node.node" "@loader_path/lib"
for tool in "$OUT/bin/"*; do
  [ -f "$tool" ] || continue
  rewrite "$tool" "@loader_path/../lib"
done

# --------------------------------------------------------------- re-sign
# install_name_tool invalidates signatures; an unsigned-but-modified dylib is
# refused by the loader on Apple silicon.
echo "==> ad-hoc signing"
signed=0
while IFS= read -r -d '' f; do
  codesign --force --sign - --timestamp=none "$f" >/dev/null 2>&1 && signed=$((signed + 1))
done < <(find "$OUT" -type f \( -name "*.dylib" -o -name "*.node" -o -perm -u+x \) -print0)
echo "  signed $signed files"

# --------------------------------------------------------------- verify
echo "==> verifying"
leaks=0
while IFS= read -r -d '' f; do
  if otool -L "$f" 2>/dev/null | tail -n +2 | awk '{print $1}' \
       | grep -qE "^(/opt/homebrew|/usr/local)"; then
    echo "  LEAK: $f still references an absolute path" >&2
    leaks=$((leaks + 1))
  fi
done < <(find "$OUT" -type f \( -name "*.dylib" -o -name "*.node" -o -perm -u+x \) -print0)

if [ "$leaks" -gt 0 ]; then
  echo "error: $leaks binaries still reference build-machine paths." >&2
  exit 1
fi
echo "  no absolute build paths remain"

# Every @rpath reference must actually resolve inside lib/. A path audit alone
# passes on a bundle that cannot load — which is exactly what happened on the
# first attempt, where an @rpath/libgeos reference had never been collected
# because Homebrew recorded it relatively rather than absolutely.
#
# `otool -D` gives a binary's own install ID, which `otool -L` also lists and
# which is not a dependency. Not excluding it makes every dylib look like it
# depends on itself.
missing_list="$(mktemp)"
while IFS= read -r -d '' f; do
  own="$(otool -D "$f" 2>/dev/null | tail -n +2 | tr -d '[:space:]' || true)"
  # `|| true` on the grep: a binary with no @rpath references at all is normal,
  # and grep's exit 1 would otherwise abort the script under `set -e` with
  # pipefail — failing the build for the one case that is entirely fine.
  refs="$(otool -L "$f" 2>/dev/null | tail -n +2 | awk '{print $1}' | grep '^@rpath/' || true)"
  while read -r ref; do
    [ -z "$ref" ] && continue
    [ "$ref" = "$own" ] && continue
    name="${ref#@rpath/}"
    [ -e "$OUT/lib/$name" ] || echo "$name <- $(basename "$f")" >> "$missing_list"
  done <<< "$refs"
done < <(find "$OUT" -type f \( -name "*.dylib" -o -name "*.node" -o -perm -u+x \) -print0)

if [ -s "$missing_list" ]; then
  echo "error: unresolved @rpath references; the bundle would fail to load:" >&2
  sort -u "$missing_list" | sed 's/^/  MISSING: /' >&2
  rm -f "$missing_list"
  exit 1
fi
rm -f "$missing_list"
echo "  all @rpath references resolve inside lib/"

# The authoritative check: relocate a copy and load it. Nothing short of
# running it proves the rewriting was correct.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R "$OUT" "$TMP/valhalla"
if (cd "$REPO" && VALHALLA_ADDON="$TMP/valhalla/valhalla_node.node" \
      npx electron scripts/verify-valhalla.mjs >"$TMP/verify.log" 2>&1); then
  grep -E "^(loaded|route|match|PASS)" "$TMP/verify.log" | sed 's/^/  /'
else
  echo "error: the relocated bundle failed to load:" >&2
  grep -E "FAIL|Library not loaded|Reason" "$TMP/verify.log" | head -5 >&2
  exit 1
fi

echo "  total: $(du -sh "$OUT" | awk '{print $1}')"
echo
echo "==> bundled into resources/valhalla"
