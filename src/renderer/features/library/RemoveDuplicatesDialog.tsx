import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DUPLICATE_UNDO_POINTS,
  duplicatesText,
  pointsCarried,
  type DuplicateGroup,
  type DuplicateKind,
  type DuplicateReport,
} from "@shared/library/duplicates";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { api, call, describeError } from "../../lib/client";
import { useLibraryStore } from "../../stores/libraryStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useUiStore } from "../../stores/uiStore";

/**
 * Remove Duplicates… for the Tracks, Routes or Waypoints section (Phase 14
 * Requirement 28, ADR 0027).
 *
 * The main process compares the content and chooses the copy that stays;
 * this lists each group with a tick box before anything is removed. A group
 * whose copies sit in more than one trip starts unticked, since copying an
 * item to another trip may be deliberate. Removal is one undo step.
 */

const NOUN: Record<DuplicateKind, { one: string; many: string; content: string }> = {
  track: { one: "track", many: "tracks", content: "the same recorded points, times and heights" },
  route: { one: "route", many: "routes", content: "the same points along the line" },
  waypoint: { one: "waypoint", many: "waypoints", content: "the same position and height" },
};

function copies(n: number): string {
  return `${n.toLocaleString("en-GB")} cop${n === 1 ? "y" : "ies"}`;
}

export function RemoveDuplicatesDialog({ kind }: { kind: DuplicateKind }): ReactNode {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const showToast = useUiStore((s) => s.showToast);
  const includeArchived = useLibraryStore((s) => s.showArchived);
  const [report, setReport] = useState<DuplicateReport | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const noun = NOUN[kind];

  useEffect(() => {
    let live = true;
    call(api().duplicates.find({ kind, includeArchived }))
      .then((found) => {
        if (!live) return;
        setReport(found);
        // Copies in different trips may be deliberate: offered, not ticked.
        setTicked(new Set(found.groups.flatMap((group, i) => (group.acrossTrips ? [] : [i]))));
      })
      .catch((cause: unknown) => {
        if (live) setFailed(describeError(cause));
      });
    return () => {
      live = false;
    };
  }, [kind, includeArchived]);

  const chosen = useMemo(() => report?.groups.filter((_, i) => ticked.has(i)) ?? [], [report, ticked]);
  const removing = chosen.reduce((n, group) => n + group.remove.length, 0);
  const tooHeavy = kind === "route" && pointsCarried(chosen) > DUPLICATE_UNDO_POINTS;

  const toggle = (index: number): void => {
    const next = new Set(ticked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setTicked(next);
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      const removals = chosen.flatMap((group) => group.remove.map((item) => ({ id: item.id, keepId: group.keep.id })));
      const outcome = await call(api().duplicates.remove({ kind, removals }));
      useSelectionStore.getState().prune(new Set());
      await useLibraryStore.getState().refresh();
      closeDialog();
      const skipped = outcome.skipped > 0 ? ` ${copies(outcome.skipped)} had changed and ${outcome.skipped === 1 ? "was" : "were"} left alone.` : "";
      showToast(
        `Removed ${duplicatesText(outcome.removed, kind)}.${outcome.undoable ? " Undo puts them back." : ""}${skipped}`,
      );
    } catch (cause) {
      showToast(describeError(cause), "error");
      setBusy(false);
    }
  };

  const title = `Remove Duplicate ${noun.many.charAt(0).toUpperCase()}${noun.many.slice(1)}`;

  return (
    <Dialog
      title={title}
      onClose={closeDialog}
      width={560}
      footer={
        <>
          <Button onClick={closeDialog} disabled={busy}>
            {report !== null && report.groups.length === 0 ? "Close" : "Cancel"}
          </Button>
          {report !== null && report.groups.length > 0 && (
            <Button variant="danger" onClick={() => void confirm()} disabled={busy || removing === 0}>
              {busy ? "Removing…" : `Remove ${copies(removing)}`}
            </Button>
          )}
        </>
      }
    >
      <div data-testid="remove-duplicates" className="grid gap-3 text-[13px] text-[var(--color-text-primary)]">
        {failed !== null && <p className="text-[var(--color-danger)]">{failed}</p>}
        {report === null && failed === null && <p className="text-[var(--color-text-secondary)]">Comparing {noun.many}…</p>}
        {report !== null && report.groups.length === 0 && (
          <p data-testid="no-duplicates">
            Compared {report.compared.toLocaleString("en-GB")} {report.compared === 1 ? noun.one : noun.many}. None have {noun.content} as another.
          </p>
        )}
        {report !== null && report.groups.length > 0 && (
          <>
            <p className="text-[var(--color-text-secondary)]">
              Compared {report.compared.toLocaleString("en-GB")} {noun.many}. These have {noun.content} as another, whatever their names. One copy of
              each stays: one a plan uses, then one in a trip, then the oldest.
            </p>
            <ul className="grid max-h-[50vh] gap-2 overflow-y-auto pr-1" aria-label="Duplicates">
              {report.groups.map((group, i) => (
                <GroupRow key={group.keep.id} group={group} checked={ticked.has(i)} onToggle={() => toggle(i)} />
              ))}
            </ul>
            {tooHeavy ? (
              <p role="note" className="rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-2 py-1.5">
                These routes hold more than {DUPLICATE_UNDO_POINTS.toLocaleString("en-GB")} points, more than one undo step carries, so this removal
                cannot be undone.
              </p>
            ) : (
              <p className="text-[12px] text-[var(--color-text-muted)]">
                This is one undo step. ⌘Z puts every copy back
                {kind === "track" ? ", rebuilt from the copy that stays, with its original file" : ""}.
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function GroupRow({ group, checked, onToggle }: { group: DuplicateGroup; checked: boolean; onToggle: () => void }): ReactNode {
  const id = `dup-${group.keep.id}`;
  return (
    <li className="rounded border border-[var(--color-border-subtle)] px-2 py-1.5" data-testid="duplicate-group">
      <label htmlFor={id} className="flex items-start gap-2">
        <input id={id} type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            Keep <span className="font-semibold">{group.keep.name}</span>
            <span className="text-[var(--color-text-muted)]"> · {group.keep.tripName}</span>
            {group.keep.inPlan && <span className="text-[var(--color-text-muted)]"> · in the plan</span>}
          </span>
          {group.acrossTrips && (
            <span className="block text-[12px] text-[var(--color-text-secondary)]">In more than one trip, so not ticked: copying to another trip may be deliberate.</span>
          )}
        </span>
      </label>
      <ul className="mt-1 ml-6 grid gap-0.5 text-[12px] text-[var(--color-text-secondary)]">
        {group.remove.map((item) => (
          <li key={item.id} className="truncate">
            Remove {item.name} · {item.tripName}
          </li>
        ))}
        {group.alsoKept.map((item) => (
          <li key={item.id} className="truncate text-[var(--color-text-muted)]">
            Also kept, a plan uses it: {item.name} · {item.tripName}
          </li>
        ))}
      </ul>
    </li>
  );
}
