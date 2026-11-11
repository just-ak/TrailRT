# Phase 5: Object and point management — Requirements

Managing what is already in the collection, rather than creating more of it.
Three capabilities, in increasing order of risk:

1. Select several routes, tracks or waypoints at once and move or delete them
   in one action.
2. Edit the points of a single route or track in a table.
3. Selecting rows in that table highlights those points on the map, so a point
   in a list of thousands can be identified without counting.

Inserted ahead of windy-roads routing, which moves to Phase 6 and Garmin
compatibility to Phase 7. The ordering is deliberate: Phase 6 generates routes
with thousands of points, and a user with no way to inspect or trim them would
be worse off than before.

## Context the investigation established

A codebase assessment was run before these requirements were written, because
all three capabilities extend existing single-object machinery rather than
sitting beside it. Five findings shape what follows.

**There is no multi-selection anywhere.** `selectionStore` holds one
`ObjectRef` plus five mutually exclusive detail slots, and `ensureGeometry`
enforces that exactly one trip's geometry is loaded at a time. Seven components
read `selected` directly.

**There is no composite undo.** One `commit()` is one undo entry, one library
refresh and one native-menu rebuild. Looping an existing channel N times gives
N of each, and ⌘Z would reverse one item per press.

**No track mutation is currently undoable, and the code claims otherwise.**
`commands.ts` registers no `track:*` handlers, so `undoService.record()`
silently discards every track inverse — including `track:deleteRange`, whose
service comment states that "the removed run is small by construction, so it is
cheap to carry as a real inverse". That is a latent defect, not a design
choice, and this phase owns fixing it.

**Route points have no stable identity.** `replacePoints` deletes every row and
re-inserts with a fresh `randomUUID()`, so a table cannot key rows on a point
id — only on index, which shifts under every insert and delete.

**Track points are deliberately not editable per point.** `deletePointRange`
is contiguous-only and collapses all segments into one. ADR 0003 and `join()`
both treat a segment break as real information about the recording.

---

## Requirement 1: Multi-selection in the library

**User story.** As someone tidying up an imported collection, I want to select
several objects at once so that moving or deleting them is one action rather
than twenty.

### Acceptance criteria

1.1. ⌘-click toggles an object's membership in the selection. Shift-click
selects the inclusive range between the anchor and the clicked row, computed
over the **currently visible rows** — a collapsed trip's hidden children are
not silently included.

1.2. A plain click replaces the selection with the clicked object, and sets it
as the anchor.

1.3. The selection may contain routes, tracks and waypoints, including a
mixture of them. Trips and folders are **excluded** from multi-selection: they
are containers whose deletion cascades, and batching a cascade behind one
keystroke is not a risk worth offering.

1.4. The selection is visible: every selected row is marked, and the panel
states how many objects are selected and of what kinds.

1.5. The tree exposes the selection to assistive technology —
`aria-multiselectable`, `aria-selected` per row, and a roving `tabIndex` so the
tree is keyboard-navigable at all. It is not today.

1.6. Keyboard: arrow keys move focus, Space toggles, Shift-arrow extends,
⌘A selects every selectable object in the visible tree, Escape collapses to
the anchor alone.

1.7. Right-clicking a row **inside** an existing multi-selection keeps that
selection and offers the batch actions. Right-clicking outside it replaces the
selection with that row, matching the current single-select behaviour.

1.8. The same object appearing in two tree positions — under its trip and in a
cross-trip view, per ADR 0004 — is one member of the selection, not two.
Selecting it in either position marks both.

1.9. Selection survives a library refresh. An object that has disappeared is
dropped from the selection silently; it is not an error.

1.10. The properties panel continues to describe the **anchor** object. It does
not attempt to merge or multi-edit, and when more than one object is selected
it says so and names what the batch actions will apply to.

---

## Requirement 2: Batch move and delete

**User story.** As someone reorganising trips, I want to move or delete a
selection in one step, and undo it in one step.

### Acceptance criteria

2.1. A multi-selection can be moved to a trip, by drag-and-drop onto the trip
or by a menu action. Tracks are included — they are currently absent from the
draggable set, which is an omission rather than a decision.

2.2. A multi-selection can be deleted.

2.3. **One batch is one undo entry.** Undoing a batch of twelve deletions
restores all twelve in one ⌘Z, and the Edit menu names the count and kind:
"Undo delete 12 routes".

2.4. A batch applies in a single transaction. If any member fails, nothing is
applied and the message names which object failed and why.

2.5. **Partial undoability is stated before the action, not discovered after
it.** Route and waypoint deletions are undoable; track deletion is not, by
ADR 0003, because the point array is too large to carry. A mixed batch must say
plainly which part cannot be reversed, and require confirmation.

2.6. A batch delete containing a track is confirmation-gated, naming the number
of tracks and total points that will be irreversibly removed.

2.7. Batch operations fire **one** library-changed notification and **one**
undo-state publication, not one per member.

2.8. A batch move across trips updates the map's loaded geometry once,
afterwards — not once per member.

2.9. The count is bounded, with the bound stated. A selection larger than the
bound is refused with the number rather than attempted.

---

## Requirement 3: Point table for a route

**User story.** As someone who drew a route slightly wrong, I want to see its
points in a table so I can correct a coordinate or remove a stray point without
hunting for a 4-pixel handle on the map.

### Acceptance criteria

3.1. The table lists the selected route's points in order with their index,
latitude, longitude, elevation, name, symbol and notes, and the cumulative
distance from the start.

3.2. Latitude, longitude and elevation are editable in place, validated against
the same bounds the IPC schema enforces. Elevation accepts empty, meaning
unknown — it does not coerce to 0.

3.3. Rows can be deleted, including a non-contiguous selection of rows. A route
must keep at least one point; emptying it is refused with the suggestion to
delete the route instead.

3.4. Rows can be reordered, and a point can be inserted before or after a
selected row.

3.5. Every edit goes through the existing `routes.setGeometry` channel, so it
is one undo entry and inherits the existing 10,000-point cap. **No new
per-point channel is introduced.**

3.6. The table reflects external changes. Dragging a vertex on the map updates
the table, because both read the same canonical geometry.

3.7. Indices are presented as 1-based for display and documented as such, since
the user-facing count is "point 1 of 240".

---

## Requirement 4: Point table for a track

**User story.** As someone whose recording has a GPS spike through a building,
I want to find and remove those samples without discarding the whole recording.

### Acceptance criteria

4.1. The table lists a track's points with index, latitude, longitude,
elevation, timestamp, and the distance and derived speed from the previous
point. Speed is the existing recorded-speed calculation, null where untimed —
never 0.

4.2. **The table is virtualised.** A 200,000-point track must scroll without
materialising 200,000 rows.

4.3. The table always reads exact points, never the simplified render cache.
Showing an index from a simplified payload would mean the row the user edits is
not the sample they are looking at. Where the map is drawing simplified
geometry, the table says so.

4.4. Rows can be deleted, including non-contiguous selections. **Segment
structure survives.** Deleting across a segment boundary does not merge the
segments, and deleting the points either side of a break does not remove the
break. The existing `deletePointRange` collapses everything into one segment,
which is acceptable for a trim and not acceptable here.

4.5. Coordinates, elevation and timestamp are editable, so a single bad sample
can be corrected rather than only removed.

4.6. **Editing a recording is labelled as such.** The panel states that the
track is measured data and that the imported original remains recoverable where
it was retained, with the restore action to hand.

4.7. Track point edits are undoable where the carried inverse is bounded, and
honestly non-undoable where it is not, with the threshold stated. This requires
registering the missing `track:*` command handlers — without them the existing
`deleteRange` inverse is discarded and the feature would silently not undo.

4.8. A track must keep at least one point.

4.9. Deleting a large number of points reports what it will do before doing it,
including whether it will be undoable.

---

## Requirement 5: Map highlighting of selected points

**User story.** As someone looking at a table row, I want to see which point on
the map it is, so I can tell whether I have found the right one.

### Acceptance criteria

5.1. Selecting one or more table rows highlights exactly those points on the
map, visibly distinct from ordinary vertices and from the selection colour used
for whole objects.

5.2. The highlight is bidirectional. Clicking a highlighted point on the map
selects its table row and scrolls it into view.

5.3. Highlighting a point outside the current view offers to bring it into
view; it does not pan the map on every row change, which would fight the
pointer during a drag-select.

5.4. Highlighting is bounded and does not degrade the map. Leaflet is configured
with `preferCanvas`, so a highlighted subset is drawn in its own layer rather
than by restyling markers in the shared canvas renderer. Above a stated number
of highlighted points the map shows the extent of the selection instead of
every individual point, and says that is what it is doing.

5.5. The **table is the accessible surface**. Canvas-rendered points cannot take
keyboard focus, so the map mirrors the table's selection and is not an
independent input for assistive technology.

5.6. Highlighting is read-only. It changes no data and creates no undo entry.

---

## Requirement 6: Consistency with what exists

6.1. Existing single-selection behaviour is unchanged when exactly one object
is selected. The seven current consumers of `selected` continue to work without
modification.

6.2. The point table is an additional view of geometry, not a second source of
truth. It reads the same canonical data the map draws.

6.3. Absent data stays absent throughout. A missing elevation or timestamp
displays as unavailable and round-trips as null.

6.4. No operation added here writes `render_geometry` without `track_points`
already being correct, per ADR 0003.

6.5. Every new IPC channel validates its payload with a zod schema and returns
a discriminated result, per the architecture rules.

---

## Out of scope, stated

- **Multi-object property editing.** Setting the colour of twelve routes at
  once is a reasonable want and is not in this phase; the properties panel
  describes the anchor only.
- **Multi-select in search results.** Search renders its own flat list for
  trips and waypoints only; extending selection into it is deferred rather
  than half-implemented.
- **Trips and folders in a multi-selection**, per 1.3.
- **Editing a track's segment structure directly.** Splitting and joining
  remain the operations for that.
- **Cross-trip multi-selection driving the map.** The map shows one trip's
  geometry; a selection spanning trips is permitted for move and delete, but
  the map follows the anchor.

## Open questions for the owner

1. **Should editing a track's coordinates be possible at all**, or should the
   table be delete-and-inspect only? Requirement 4.5 assumes correcting a
   single bad sample is worth having. The opposing view is that a recording is
   measurement and should only ever be trimmed, never rewritten. The retained
   original makes either position defensible.
2. **What bound on a batch?** Requirement 2.9 asks for one without naming it.
3. **What bound on highlighted points** before switching to an extent, per 5.4?
