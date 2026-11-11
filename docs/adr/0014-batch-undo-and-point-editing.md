# ADR 0014: Batch operations, the track undo gap, and point-level editing

Status: accepted
Date: 2026-11-07
Relates to ADR 0001 (autosave and undo), ADR 0003 (track storage), ADR 0004
(library tree is saved views)

## Context

Phase 5 adds multi-selection with batch move and delete, and a table editor for
the points of a single route or track. All three extend machinery built for one
object at a time, so a codebase assessment was run first. It found four things
that shape the decisions below, one of which is a defect.

## Decision

### 1. Multi-selection is a set beside the anchor, not a replacement for it

`selectionStore` holds one `ObjectRef` plus five mutually exclusive detail
slots, and seven components read `selected`. A collection-shaped rewrite would
change the meaning of `route`, `track` and `waypoint` for every reader.

Instead `selectedKeys: ReadonlySet<string>` and `anchorKey` sit beside
`selected`, which remains the anchor. Existing consumers are untouched.

Two constraints are kept rather than worked around:

- **Detail loads for the anchor only.** `tracks.get` returns every point, up to
  200,000; the store already notes this is paid "once per selection rather than
  per render". Multiplying it by the selection size buys nothing, because the
  properties panel describes one object.
- **One trip of geometry at a time.** `ensureGeometry` enforces this and the map
  was never going to show two trips. A selection spanning trips is allowed for
  move and delete, and the map follows the anchor.

A `Set` of `kind:id` keys rather than an array of refs, because the tree
re-renders every row on a selection change and a linear membership scan per row
is quadratic in the selection size.

### 2. Two keyspaces stay separate

`TreeNode.id` is a path; selection is keyed `kind:id`. That asymmetry exists
because ADR 0004 puts the same object under its trip and in a cross-trip view.

A Shift-click range is computed over the flattened **visible** rows keyed by
path, and yields members keyed by `kind:id`. "One object selected in two tree
positions is one member of the selection" then falls out for free rather than
needing a special case.

### 3. A batch is one composite command, not a loop

`commit()` records one inverse, notifies the library once, and republishes the
undo state — which rebuilds the native menu, because Electron menus are
immutable once built. Looping an existing channel for a batch of twelve gives
twelve undo entries, twelve refreshes and twelve menu rebuilds, and ⌘Z reverses
one item per press.

So a `'batch'` command kind applies children in one transaction and returns a
batch inverse with the children **reversed** — unwinding in application order
can run a restore before the delete that made room for it. Because
`applyCommand` returns a `Mutation`, the inverse of a batch is a batch: the
same self-inverting trick single commands use, one level up.

Two details that are easy to get wrong, recorded because they are:

- **`isUndoable` must look inside a batch.** All-`none` children — a batch of
  track deletions — would otherwise record a step that does nothing.
- **Labels need a count.** `LABELS` is a flat record keyed by kind, so "delete
  12 routes" cannot come from it. `record(inverse, label?)` already accepts an
  optional label that no caller currently uses.

### 4. The missing `track:*` handlers are a bug, and this phase fixes it

`commands.ts` registers no `track:*` handlers. `trackService` emits
`track:update`, `track:move`, `track:reverse`, `track:restorePoints`,
`track:deleteRange` and `track:delete`; `commit()` passes them all to
`record()`; and `record()` discards every one, because `isUndoable` tests
`kind in HANDLERS`.

So **no track mutation is undoable today** — a track rename or move cannot be
reversed — and `deletePointRange` carries a comment claiming "the removed run
is small by construction, so it is cheap to carry as a real inverse" for an
inverse that is thrown away.

The handlers with bounded inverses are registered. `track:delete` stays `none`
deliberately, per ADR 0003: a point array that large is not going on a stack
bounded at 50 entries.

This is a defect, not a design choice, and it is a prerequisite rather than a
nicety — point-table editing for tracks cannot be undoable without it.

### 5. Partial undoability is disclosed before the action

Routes and waypoints delete undoably; tracks, trips and folders do not. A mixed
batch is therefore partly irreversible.

The batch service computes which members are not undoable and exposes that as a
dry-run query, so the UI states it **before** the action and gates it behind
confirmation. Discovering afterwards that four of twelve deletions cannot be
undone is the kind of surprise the honesty rule in the architecture steering
exists to prevent.

### 6. Route point editing reuses `setGeometry`; no per-point channel

`setGeometry` replaces the whole array in one transaction and its inverse is
the previous array, which is why the 10,000-point cap exists. A table editor
building a new array and sending it through that channel gets one undo entry
and the existing validation for free.

A per-point channel would produce a worse undo story — one entry per keystroke
— for no gain. It is therefore ruled out rather than left as an option.

### 7. Non-contiguous track point deletion gets a new operation

`deletePointRange` is contiguous-only **and collapses every segment into one**.
That is right for trimming a tail and wrong for removing scattered GPS spikes:
ADR 0003 and `join()` both treat a segment break as real information about the
recording.

A new `deletePointsAt(db, id, indices)` rebuilds segments preserving breaks,
including a break whose adjacent points were both deleted. `deletePointRange`
keeps its current behaviour unchanged — it has a different job.

Its inverse carries the removed points with their positions, so it is bounded
by how many were deleted rather than by track size. Above a threshold it
reports `none` and says so, following `simplifyTrack` and
`routingService.snapRoute`.

### 8. Row identity is the index, because there is no id to use

`replacePoints` deletes every row and re-inserts with a fresh `randomUUID()`,
so a route point has no identity across an edit. The table keys on index.

Consequences, recorded because "just key on the id" is the obvious instinct and
there is no id:

- An edit invalidates every index after it.
- The table reloads after any mutation rather than patching locally.
- A pending row selection is remapped or cleared on reload, never silently
  reinterpreted against shifted indices — which would delete the wrong points.

### 9. Highlighting draws into its own layer, because of the canvas

Leaflet runs `preferCanvas: true`, so track points are `circleMarker`s in a
shared canvas renderer: no DOM node per point to restyle, and `setStyle()` on
one redraws the whole pane. The existing handles effect also does a full
`clearLayers()`, so adding highlighted indices to its dependencies would
rebuild every vertex handle on every row click.

Highlighting therefore gets a third layer group per hook. Above a bounded count
it draws the **extent** of the selection rather than every point, which is what
keeps a select-all on a large track from attempting 200,000 markers — exactly
what the existing `showPoints` guards prevent.

Canvas-drawn points cannot take keyboard focus, so the **table is the accessible
surface** and the map mirrors it. The map is not an independent input for
assistive technology.

## Consequences

- Single-object selection behaves exactly as before; the seven existing
  consumers of `selected` need no change.
- Track mutations become undoable for the first time, which is a visible
  behaviour change users will notice as a fix.
- The undo stack holds more user intent at the same depth, because a batch is
  one entry.
- Tracks gain point-level editing, which is a softening of "a recording is
  measured data". It is bounded: the imported original stays recoverable, the
  UI says the data is measured, and trimming and simplification remain the
  primary operations. Whether coordinate correction should exist at all is an
  open question in the requirements.
- The library tree gains a keyboard model and `aria-multiselectable`, neither
  of which it had.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Rewrite `selectionStore` as a collection | Touches seven consumers and changes what the detail slots mean, to support a properties panel that still shows one object |
| Loop existing channels for a batch | N undo entries, N library refreshes, N native-menu rebuilds, and ⌘Z reverses one member per press |
| Extend `deletePointRange` to take index sets | It collapses segments by design; overloading it would destroy segment breaks for the trim case too |
| A per-point edit channel for routes | One undo entry per keystroke, when `setGeometry` already gives one per edit with a bounded inverse |
| Restyle existing markers to highlight | A canvas renderer redraws the whole pane per `setStyle`, and the handles effect rebuilds every vertex |
| Leave the track undo gap alone | It is a defect with a misleading comment, and Requirement 4.7 depends on it |
