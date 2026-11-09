# Phase 5: Object and point management — Tasks

Execute in order. The undo-stack repair comes first because two later tasks
depend on it, and the pure work comes before the UI so the services are proven
before anything draws them.

Update `docs/progress-mindmap.svg` as each task changes status.

- [x] 1. Repair the track undo gap
  - Register the missing `track:*` handlers in `commands.ts`: `track:update`,
    `track:move`, `track:reverse`, `track:restorePoints`, `track:deleteRange`
  - `track:delete` stays `none` deliberately, per ADR 0003 — a point array that
    large is not carried on the stack
  - Add labels for each, so the Edit menu names what it will undo
  - A bug fix, not a feature: every track inverse is currently discarded by
    `record()` because `isUndoable` tests `kind in HANDLERS`, so a track rename
    or move cannot be undone today and `deleteRange` claims an inverse it does
    not have
  - Unit tests: a track move, rename, reverse and range delete each round-trip
    through undo and redo; a track deletion still reports non-undoable
  - _Requirements: 4.7_

- [x] 2. Composite batch command
  - `'batch'` kind in `commands.ts`, applying children in one transaction and
    returning a batch inverse with the children **reversed**
  - `isUndoable` looks inside a batch: one whose children are all `none`
    records nothing rather than a step that does nothing
  - Batch-aware labels through the `label` argument `record()` already accepts
  - Unit tests: one entry per batch, reverse unwind order, all-`none` batch
    records nothing, a mid-batch failure applies nothing
  - _Requirements: 2.3, 2.4, 2.7_

- [x] 3. Batch service
  - `batchService.remove` and `batchService.moveToTrip`, composing the existing
    per-object mutations rather than reimplementing them
  - `BatchOutcome` reports counts per kind and which members are not undoable
  - A dry-run query returning the same assessment, so the UI can warn before
    the action rather than after
  - Selection bound enforced, refusing with the count
  - Unit tests: mixed-kind batches, the undoability assessment matches what the
    batch actually records, the bound is refused cleanly
  - _Requirements: 2.1, 2.2, 2.5, 2.9_

- [x] 4. Non-contiguous track point deletion
  - `trackService.deletePointsAt(db, id, indices)` rebuilding segments with
    breaks preserved, including a break whose adjacent points were both deleted
  - `deletePointRange` keeps its current trimming behaviour unchanged — it
    collapses segments, which is right for a trim and wrong here
  - Inverse carries the removed points with their indices and segment
    positions, so it is bounded by the number deleted rather than track size;
    above a threshold it reports `none` and says so
  - Refuses to empty a track
  - Unit tests: non-contiguous deletion across a boundary preserves breaks,
    inverse restores exactly, the threshold is honoured
  - _Requirements: 4.4, 4.7, 4.8_

- [x] 5. Track point editing and paged reads
  - `trackService.editPointAt` for coordinates, elevation and timestamp
  - Paged read: `tracks.points({ id, offset, limit })` returning the window,
    the total, and `segmentBreaks` — the renderer cannot infer a break from a
    window that does not contain one
  - Reads exact points, never the render cache
  - Unit tests: window boundaries, breaks at a boundary, totals consistent
    under concurrent edits, absent elevation and timestamp round-trip as null
  - _Requirements: 4.1, 4.3, 4.5, 6.3, 6.4_

- [x] 6. IPC and preload wiring
  - Channels for batch move, batch delete, the dry-run assessment, paged track
    points, and the track point edit and delete operations
  - Zod schemas for every payload; results never throw across the boundary
  - Route point editing adds **no** channel — it reuses `routes.setGeometry`
  - _Requirements: 3.5, 6.5_

- [x] 7. Multi-selection in the selection store
  - `selectedKeys` and `anchorKey` beside `selected`, which stays the anchor
  - Detail loading stays keyed on the anchor; `ensureGeometry` keeps its
    one-trip rule
  - Pruning takes the surviving keys in one operation, for a batch delete
  - Unit tests: toggle, range, replace, pruning after a batch delete, the five
    detail slots still describe the anchor only
  - _Requirements: 1.1, 1.2, 1.9, 6.1_

- [x] 8. Library tree: selection and keyboard model
  - `TreeRow` forwards `{ metaKey, shiftKey }` and its path — it discards the
    event today
  - Range selection computed over the flattened **visible** rows, keyed by
    path, producing members keyed by `kind:id`
  - Roving `tabIndex`, `aria-multiselectable`, `aria-selected` per row, arrow
    and Shift-arrow navigation, Space, ⌘A, Escape
  - Trips and folders excluded from multi-selection
  - Selection count and composition shown in the panel
  - E2E: modifier-click selection over visible rows only; keyboard navigation
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.8, 1.10_

- [x] 9. Batch actions in the UI
  - Context menu keeps an existing multi-selection when right-clicked inside
    it, and replaces it when right-clicked outside
  - Batch drag-and-drop onto a trip, with `track` added to the draggable set
  - Confirmation naming what is irreversible, for any batch containing a track
  - Native menu and Edit-menu labels carry the count
  - E2E: one ⌘Z reverses a batch delete; a mixed batch warns before acting
  - _Requirements: 1.7, 2.1, 2.2, 2.5, 2.6, 2.8_

- [x] 10. Point table
  - One virtualised component over a normalised row model, for both kinds
  - Route columns: index, lat, lon, elevation, name, symbol, notes, cumulative
    distance. Track columns: index, lat, lon, elevation, time, distance and
    derived speed from the previous point
  - In-place editing with the same bounds the schemas enforce; empty elevation
    means unknown, not 0
  - Row selection, insert, reorder, and non-contiguous delete
  - Reloads after every mutation; a pending row selection is remapped or
    cleared rather than reinterpreted against shifted indices
  - Says when the map is drawing simplified geometry
  - States that a track is measured data, with the restore action to hand
  - E2E: a 200,000-point table scrolls without materialising every row
  - _Requirements: 3.1–3.7, 4.1, 4.2, 4.3, 4.6, 4.9, 6.2_

- [x] 11. Map highlighting
  - `useHighlightLayer`: a third layer group, so a row click does not rebuild
    every vertex handle
  - Bidirectional — clicking a highlighted point selects and scrolls to its row
  - Offers to bring an off-screen point into view rather than panning on every
    row change
  - Above the bound, draws the extent of the selection and says so
  - Read-only: no data change, no undo entry
  - E2E: selecting rows highlights the matching points; clicking a point
    selects its row
  - _Requirements: 5.1–5.6_

- [x] 12. Phase 5 verification pass
  - `npm run verify` green; e2e green against the packaged build
  - Walk the acceptance criteria: single selection behaves exactly as before;
    one batch is one undo entry; a mixed batch states what it cannot reverse;
    segment breaks survive a non-contiguous delete; the table never shows
    simplified indices
  - Confirm the track undo repair from task 1 holds end to end
  - Update the mindmap to show Phase 5 complete
  - _Requirements: all_
