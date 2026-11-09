# Phase 5: Object and point management — Design

Three features that each extend single-object machinery: multi-selection,
point tables, and point highlighting on the map. The interesting content of this
design is not the features — it is the five existing invariants they collide
with, and what each collision resolves to.

## 1. Multi-selection: a set beside the anchor, not instead of it

`selectionStore` is single-select by shape: one `ObjectRef` plus five mutually
exclusive detail slots, where `reload()` spreads `EMPTY` on every branch so
exactly one slot is ever populated. Seven components read `selected`.

Rewriting that into a collection would touch all seven and change the meaning of
`route`, `track` and `waypoint` for every reader. Instead:

```ts
interface SelectionState {
  /** The anchor: last clicked, and the object the properties panel describes. */
  selected: ObjectRef | null;
  /**
   * Every selected object including the anchor, keyed `kind:id`.
   *
   * A Set of keys rather than an array of refs so membership is O(1) per tree
   * row — the tree re-renders every row on selection change, and a linear
   * scan per row is quadratic in the selection size.
   */
  selectedKeys: ReadonlySet<string>;
  /** Where a Shift-click range starts. Null until something is clicked. */
  anchorKey: string | null;
  // ... the five detail slots, unchanged, describing the anchor only
}
```

Three consequences fall out, and each is a deliberate answer to a constraint the
investigation surfaced:

**Detail loading stays keyed on the anchor.** `tracks.get` returns every point —
up to 200,000 — which the store's own comment notes is paid "once per selection
rather than per render". Loading detail for a multi-selection of tracks would
multiply that payload by the selection size for no benefit, because the
properties panel shows one object.

**`ensureGeometry` keeps its one-trip rule.** The map shows a single trip's
geometry. A selection spanning trips follows the anchor, which is Requirement
6.1's "unchanged when one object is selected" extended honestly: the map was
never going to show two trips, and pretending otherwise would be a bigger change
than this phase is buying.

**Pruning is explicit.** The existing `reload()` branches already null
`selected` when an object has vanished. `selectedKeys` needs the same treatment,
and a batch delete needs it for N objects at once — so pruning becomes a single
operation taking the keys that survived rather than a per-branch conditional.

### Two keyspaces that must not be conflated

`TreeNode.id` is a **path** (`view:routes/route:abc`), deliberately distinct
from the object ref, because ADR 0004 puts the same route under its trip and in
the cross-trip Routes view. Expansion state and React keys use the path;
selection uses `kind:id`.

A Shift-click range is computed over the **flattened visible row list keyed by
path**, and produces members keyed by `kind:id`. Requirement 1.8 — one object
selected in two places is one member — is a direct consequence of that
asymmetry, and it falls out for free rather than needing special handling.

`TreeRow.onClick` currently discards its event, so the modifier keys are not
available. It must forward `{ metaKey, shiftKey }` and the row's path.

## 2. Batch operations: a composite command

`commit()` in `register.ts` is the single funnel for every mutation: it records
one inverse, notifies the library once, and republishes the undo state — which
also rebuilds the native menu, because Electron menus are immutable once built.

Looping an existing channel for a batch therefore gives N undo entries, N
library refreshes and N menu rebuilds, and ⌘Z would reverse one item per press.
Requirements 2.3 and 2.7 both rule that out.

The composite fits the existing contract without changing it:

```ts
// commands.ts
| 'batch'

'batch': (db, p) => {
  const commands = commandArray(p);
  const applied = db.transaction(() =>
    commands.map((command) => applyCommand(db, command)),
  );
  return {
    result: applied.map((m) => m.result),
    // Reversed: undoing a batch must unwind in the opposite order it applied,
    // or a restore can run before the delete that made room for it.
    inverse: {
      kind: 'batch',
      payload: { commands: applied.map((m) => m.inverse).toReversed() },
    },
  };
}
```

Because `applyCommand` returns a `Mutation`, the inverse of a batch is a batch —
the same trick that makes single commands self-inverting, applied one level up.

Three details that are easy to get wrong:

**`isUndoable` must look inside.** A batch whose children are all `none` — a
batch of track deletions — would otherwise report as undoable and put a step on
the stack that does nothing. The batch handler filters `none` children, and a
batch that filters down to nothing records nothing.

**Labels need the count.** `LABELS` is a flat `Record<CommandKind, string>`, so
"delete 12 routes" cannot come from it. `record(inverse, label?)` already
accepts an optional label that no caller currently uses; batch callers pass one.

**The stack bound still applies.** `MAX_DEPTH = 50`. A batch is one entry, so
batching makes the stack hold *more* user intent, not less.

### Service layer

Batch move and delete are composed in a service from the existing single-object
operations, not reimplemented:

```ts
// batchService.ts
export function remove(db, refs): Mutation<BatchOutcome>
export function moveToTrip(db, refs, tripId): Mutation<BatchOutcome>
```

Each collects the per-object `Mutation`s inside one transaction and returns a
batch inverse. `BatchOutcome` reports counts per kind and, critically, which
members were **not** undoable — Requirement 2.5 needs that at the UI before the
action, so the same calculation is exposed as a dry-run query.

### The track undo gap

`commands.ts` registers no `track:*` handlers. `trackService` emits
`track:update`, `track:move`, `track:reverse`, `track:restorePoints`,
`track:deleteRange` and `track:delete` as inverses; `commit()` passes them all
to `record()`; and `record()` drops every one because `isUndoable` tests
`kind in HANDLERS`.

So today a track move or rename cannot be undone, and `deleteRange` claims an
inverse it does not have. This phase registers the handlers that have bounded
inverses — `track:update`, `track:move`, `track:reverse`, `track:restorePoints`,
`track:deleteRange` — and leaves `track:delete` as `none` deliberately, per
ADR 0003.

That is a bug fix rather than a feature, and it is a prerequisite: Requirement
4.7 cannot be satisfied without it.

## 3. Point tables: one shape, two very different data paths

A single `PointTable` component over a normalised row model, with a virtualised
body. The data paths behind it diverge completely, because routes and tracks are
stored differently on purpose (ADR 0003).

| | Route | Track |
| --- | --- | --- |
| Source | `routes.get` — whole array | New paged channel |
| Cap | 10,000, already enforced | ~200,000, unbounded today |
| Row identity | **Index only** | **Index only** |
| Edit channel | Existing `routes.setGeometry` | New targeted channels |
| Undo | Whole previous array, already bounded | Targeted inverse, bounded by count |

### Routes: reuse `setGeometry`, add nothing

Route edits build a new array and send it through the existing channel. One
undo entry, the existing 10,000 cap, the existing validation. Requirement 3.5
forbids a per-point channel, and the reason is concrete: `setGeometry`'s inverse
is already the previous array, so a per-point channel would produce a worse undo
story for no gain.

### Tracks: paged reads, targeted writes

A 200,000-point track cannot be sent to the renderer as one payload for a table
that shows forty rows. A paged read channel returns a window plus the total:

```ts
tracks.points({ id, offset, limit }) -> { total, offset, points, segmentBreaks }
```

`segmentBreaks` carries the indices where a segment ends, because Requirement
4.4 demands segment structure survive a delete and the renderer cannot infer
breaks from a window that does not contain one.

Writes are targeted. The existing `deletePointRange` is contiguous-only **and
collapses every segment into one** — fine for trimming a tail, wrong here. A
new operation takes a set of indices and rebuilds segments preserving breaks:

```ts
trackService.deletePointsAt(db, id, indices): Mutation<TrackWithPoints>
```

Its inverse carries the removed points with their indices and segment
positions, so it is bounded by how many were deleted rather than by track size.
Above a threshold it reports `none` and says so, following the precedent set by
`simplifyTrack` and `routingService.snapRoute`.

### Row identity is the index, and that is a real constraint

`replacePoints` re-UUIDs every row, so there is no stable point id to key on.
The table keys on index, which means:

- An edit invalidates every index after the edit point.
- The table reloads after any mutation rather than patching locally.
- A pending selection of rows is remapped or cleared on reload — not silently
  reinterpreted against shifted indices, which would delete the wrong points.

This is worth stating because "just key on the id" is the obvious instinct and
there is no id to use.

## 4. Point highlighting: a separate layer, because of the canvas

Leaflet runs with `preferCanvas: true`. Consequences:

- Track points are `L.circleMarker`s drawn into a **shared canvas renderer**.
  There is no DOM node per point, so there is nothing to restyle with CSS, and
  `setStyle()` on one marker redraws the whole renderer pane.
- Canvas-drawn points cannot take keyboard focus, which is why Requirement 5.5
  makes the **table** the accessible surface and the map a mirror.

So highlighting is a **third layer group** holding only the highlighted subset,
rather than restyling members of the existing layer:

```
useRouteLayers   lines | handles | highlight   (new)
useTrackLayers   lines | markers | highlight   (new)
```

The existing handles effect does a full `clearLayers()` and depends on
`[map, routes, selectedId, enabled]`. Adding `highlightedIndices` to it would
rebuild every vertex handle on every table-row click. A separate layer means a
row click touches only the highlight group.

Above the Requirement 5.4 bound the highlight layer draws the **extent** of the
selection — a bounding rectangle — instead of individual points, and the table
says that is what it is showing. That keeps a select-all on a 200,000-point
track from attempting 200,000 markers, which is precisely what the existing
`showPoints` guards exist to prevent.

`showPoints` itself stays as it is: opt-in, selected-track-only, exact-geometry-
only. Highlighting is independent of it, because a highlighted point must be
visible whether or not every point is.

## 5. Where things live

```
src/
  shared/
    domain/types.ts           SelectionSet helpers, PointRow
    ipc/schemas.ts            batch, paged points, point-edit payloads
  main/
    services/
      batchService.ts         composes existing mutations into one
      trackService.ts         + deletePointsAt, editPointAt
      commands.ts             + 'batch', + the missing track:* handlers
    db/repositories/
      tracks.ts               + paged point read
  renderer/
    stores/selectionStore.ts  + selectedKeys, anchorKey, pruning
    features/
      library/                multi-select, keyboard model, batch menu
      points/                 PointTable, virtualised body, row model
      map/                    + useHighlightLayer
```

## 6. Risks, and what each resolves to

| Risk | Resolution |
| --- | --- |
| A mixed batch delete is partly irreversible | Stated before the action and confirmation-gated (2.5, 2.6), not discovered afterwards |
| Index-keyed rows go stale under concurrent edits | Reload after every mutation; remap or clear a pending row selection rather than reinterpret it |
| Non-contiguous track delete destroys segment breaks | New `deletePointsAt` rebuilds segments; `deletePointRange` keeps its trimming behaviour unchanged |
| Highlighting many canvas points stalls the map | Separate layer, bounded count, extent rectangle above it |
| A paged table disagrees with the map | Table always reads exact points; where the map is simplified the table says so (4.3) |
| The tree gains a keyboard model it never had | Roving `tabIndex` and `aria-multiselectable` are explicit requirements (1.5, 1.6), not incidental |

## 7. Testing

Unit, against the services:

- Batch undo is one entry, unwinds in reverse order, and a batch of
  non-undoable members records nothing.
- A batch that fails mid-way applies nothing.
- `deletePointsAt` with non-contiguous indices preserves segment breaks, and
  preserves a break whose adjacent points were both deleted.
- The missing `track:*` handlers now round-trip: a track move undoes.
- Route point edits remain within the 10,000 cap and produce one undo entry.
- Paged point reads return consistent totals and correct segment breaks at a
  window boundary.

End-to-end:

- ⌘-click and Shift-click build the expected selection over visible rows only.
- One ⌘Z reverses a batch delete of several routes.
- A mixed batch naming a track is confirmation-gated and says what is
  irreversible.
- Selecting table rows highlights the matching map points; clicking a
  highlighted point selects its row.
- A large track's table scrolls without materialising every row.
