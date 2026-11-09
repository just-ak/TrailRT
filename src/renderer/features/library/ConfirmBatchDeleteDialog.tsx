import { useState, type ReactNode } from 'react';
import type { BatchAssessment, BatchMember } from '@shared/domain/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { api, call, describeError } from '../../lib/client';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiStore } from '../../stores/uiStore';

interface Props {
  members: BatchMember[];
  assessment: BatchAssessment;
}

function describe(counts: Record<string, number>): string {
  const parts = ['route', 'track', 'waypoint']
    .filter((kind) => (counts[kind] ?? 0) > 0)
    .map((kind) => {
      const n = counts[kind] ?? 0;
      return `${n} ${kind}${n === 1 ? '' : 's'}`;
    });
  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) as string}`;
}

/**
 * Confirmation for a batch deletion.
 *
 * The whole reason this exists rather than deleting straight away is
 * Requirement 2.5: a batch can be **partly** irreversible. Route and waypoint
 * deletions come back with one ⌘Z; a track deletion does not, because its
 * point array is too large to carry on the undo stack (ADR 0003).
 *
 * So the dialog names the split explicitly, and the number of recorded points
 * that are about to go. The assessment comes from the main process, which is
 * also what gates the mutation — the warning cannot promise something the
 * deletion will not honour.
 */
export function ConfirmBatchDeleteDialog({
  members,
  assessment,
}: Props): ReactNode {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const showToast = useUiStore((s) => s.showToast);
  const refresh = useLibraryStore((s) => s.refresh);
  const [busy, setBusy] = useState(false);

  const summary = describe(assessment.counts);
  const irreversible = assessment.notUndoable.length > 0;

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      const outcome = await call(api().batch.delete({ members }));
      // The deleted objects cannot be in the selection any more. Pruning to an
      // empty surviving set is simplest and correct: the refresh below will
      // re-seed anything the user clicks next.
      useSelectionStore.getState().prune(new Set());
      await refresh();
      closeDialog();
      showToast(
        outcome.undoable
          ? `Deleted ${describe(outcome.counts)}. Undo restores ${
              irreversible ? 'what can be restored' : 'all of it'
            }.`
          : `Deleted ${describe(outcome.counts)}.`,
      );
    } catch (cause) {
      showToast(describeError(cause), 'error');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Delete ${summary}?`}
      onClose={closeDialog}
      footer={
        <>
          <Button onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? 'Deleting…' : `Delete ${assessment.total}`}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-[var(--color-text-primary)]">
        {summary} will be deleted.
      </p>

      {assessment.reason !== null && (
        <p
          // A role of its own: this is the sentence the decision turns on, and
          // a screen reader should not have to reach it by reading the list.
          role="note"
          className="mt-3 rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
        >
          {assessment.reason}
        </p>
      )}

      {irreversible && (
        <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]">
          A track imported from a file can still be recovered by importing it
          again, or from an automatic backup.
        </p>
      )}

      {!irreversible && assessment.undoable && (
        <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">
          This is one undo step. ⌘Z restores all of it.
        </p>
      )}

      {assessment.missing.length > 0 && (
        <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">
          {assessment.missing.length} of the selected objects no longer exist
          and will be ignored.
        </p>
      )}
    </Dialog>
  );
}
