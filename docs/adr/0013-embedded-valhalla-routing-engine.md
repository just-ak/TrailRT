# ADR 0013: Embed Valhalla in-process; ship arm64 only

Status: accepted
Date: 2026-11-07
Supersedes part of ADR 0011 and ADR 0012 §9

## Context

Phase 4 shipped road snapping, road classes and posted speed limits against an
**external** Valhalla server that the user had to supply. There was no default
endpoint, by policy, so out of the box none of it worked.

The owner's requirement is posted speed limits in the finished product. That
makes `trace_attributes` non-negotiable: it is the only source of a posted
limit, and the alternatives that avoid an external engine would have put it at
risk.

The owner asked for the engine to be bundled and managed by the app's
startup and shutdown. Investigating that turned up four facts that reshaped it:

1. **Valhalla publishes no binaries.** Releases 3.9.1, 3.9.0 and 3.8.3 carry
   zero artefacts — source only. Homebrew core has no formula; the
   `valhalla/valhalla` tap pins 3.0.2 at a 2019 revision and references
   `boost-python` and `MacOS.version <= :lion`. `pyvalhalla` has wheels but
   macOS arm64 only, and is a CPython extension.
2. **Valhalla 3.9 ships N-API Node bindings** — `node-addon-api` 8.5.0,
   `NAPI_VERSION=8`, zero `v8::` or `nan` usage — wrapping
   `valhalla::tyr::actor_t`, which accepts the same JSON as the HTTP API.
3. **N-API is ABI-stable across Node and Electron**, the property ADR 0010
   already relies on for `better-sqlite3`.
4. **Regional graphs are small.** Liechtenstein's 3.3 MB extract builds a
   4.4 MB graph in 0.6 s.

## Decision

### 1. Embed the engine in-process. There is no server

Valhalla is loaded as an N-API addon in the **main process**. `ENABLE_SERVICES`
is OFF, which drops `prime_server`, `zeromq` and `czmq`.

So there is no daemon, no listening socket, no port to collide with, no child
process to supervise, and nothing to start or stop — the lifecycle management
the brief asked for turned out to be unnecessary rather than merely cheap.

Measured in Electron 45 against a local graph: `route` 52 ms,
`trace_attributes` 7 ms over 51 edges. The public demo instance was roughly
500 ms per call plus a 1.1 s politeness delay.

`ENABLE_TOOLS` stays ON for `valhalla_build_tiles`, which turns a user's chosen
region into a graph. Those are one-shot CLIs run at import time, never while
routing.

### 2. The HTTP adapter stays

`main/routing/valhalla.ts` is unchanged and still supported. The request bodies
are identical — the actor takes the same JSON — so the embedded provider is a
sibling adapter, not a replacement. Keeping both means a user who already runs
a shared Valhalla can point at it, and the live HTTP verification
(`npm run verify:valhalla:remote`) stays meaningful.

The embedded engine is preferred when present, because it needs no endpoint and
**no consent prompt**: nothing leaves the machine, so there is nothing to ask
permission for.

### 3. arm64 only. Intel Macs are not supported

An x64 build needs a second Homebrew toolchain in `/usr/local` under Rosetta
and a second compile on every release, for a shrinking share of machines.

The honest consequence is recorded rather than hidden: the DMG is named
`-arm64`, the README says Apple silicon only, and `minimumSystemVersion`
guarantees an Intel user gets a refusal rather than a crash.

### 4. The minimum macOS version rises to 13.3

Valhalla uses libc++'s `<format>`, whose floating-point formatter calls
`std::to_chars` — unavailable before macOS 13.3. Electron 45 alone would run on
13.0.

`minimumSystemVersion: '13.3'` in `electron-builder.yml` matches the claim to
what the binary can load. Declaring 13.0 while shipping a 13.3 addon would be a
launch failure on 13.0–13.2 instead of a clear "unsupported".

### 5. Relocatability is verified by loading, not by auditing paths

Homebrew records dependencies as absolute paths, so the addon must be rewritten
to be relative. `scripts/bundle-valhalla.sh` collects the transitive closure —
113 libraries, 38.6 MB — rewrites every reference to `@rpath`, adds
`@loader_path`-relative rpaths, and re-signs ad-hoc because `install_name_tool`
invalidates a signature.

Two things that caught the first attempt, both recorded because they are easy
to repeat:

- **`@loader_path`, not `@executable_path`.** `dylibbundler` and most guides use
  the latter, which resolves against the running executable. For a `.node`
  loaded by Electron that is Electron's own binary, several directories away.
- **Homebrew mixes absolute and relative references.** `libgeos_c` records geos
  as `@rpath/libgeos.3.15.0.dylib`. A collector that only follows absolute
  paths skips it silently and produces a bundle that passes a path audit and
  then fails to load.

Because of the second, the script's final step relocates a copy to a temporary
directory and **loads it in Electron**. A path audit alone passed on a bundle
that could not load; only running it is evidence.

### 6. Licensing

Valhalla is MIT. Its sixteen bundled third-party components are MIT, Boost,
Apache-2.0, BSD-2-Clause, ISC or public domain. Nothing carries a field-of-use
restriction and nothing is GPL-2.0-only, so all of it combines with GPL-3.0.

Two linked libraries need their election recorded, because their default terms
alone would not be compatible:

| Library | Terms | Election |
| --- | --- | --- |
| libspatialite, readosm | MPL-1.1 / GPL-2.0+ / LGPL-2.1+ tri-licence | **LGPL-2.1-or-later.** MPL-1.1 alone is GPL-incompatible; the "or later" arms are not |
| GEOS | LGPL-2.1-or-later | Used as-is |

`docs/licences/third-party-register.md` carries a native section, maintained by
hand: these are not npm dependencies, so `npm run licences` cannot see them.

Shipping compiled Valhalla makes it part of the combined work, so releases must
publish its corresponding source. The pinned tag in `scripts/build-valhalla.sh`
plus the public repository satisfies that, and Valhalla being MIT means its own
terms impose no further obligation.

## Consequences

- The DMG grows from 128 MB to 146 MB. The 58 MB bundle compresses well.
- Building the app now has a prerequisite: `npm run build:valhalla`, which needs
  Homebrew and roughly seven minutes of compilation. It is not part of
  `npm run verify`, so ordinary development is unaffected.
- A user must still supply a region. The engine is useless without a graph, and
  that pipeline is the remaining work.
- Routing no longer requires network access, an endpoint, or consent. The
  consent machinery stays for the HTTP adapter, where it is still needed.
- Protobuf 36 contributes roughly 40 abseil dylibs on its own. Linking protobuf
  statically would cut the library count substantially and is the obvious size
  optimisation if 146 MB becomes a problem. Not done now: it is a size
  question, not a correctness one.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Bundle `valhalla_service` and supervise it | Needs `prime_server`, `zeromq`, `czmq`, an autotools build, a port, a health check and a shutdown path — all to reach a result the in-process addon gives directly |
| `valhalla-wasm` | A single 0.1.0 release whose npm homepage (`ecc521`) disagrees with the repository found (`tobilg`), described as turn-by-turn only. If it lacks `trace_attributes` it fails the one hard requirement |
| A routing engine written in TypeScript | Weeks of work, and would have had to reimplement map matching to recover posted speed limits. Still the right answer for Phase 5 if per-edge costs cannot be expressed through Valhalla — ADR 0012 §9 remains open |
| Keep external-only | Leaves the headline feature unavailable unless the user runs a server |
| Ship x64 too | A second Rosetta toolchain and a second compile per release, for a shrinking share of machines |
