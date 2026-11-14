import { useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useUiStore } from '../../stores/uiStore';
import { unlink } from './photoActions';

/** Requirement 1.8 and design §4.4. Undoable, and the files are untouched. */
export function UnlinkFolderDialog({ folderId, name }: { folderId: string; name: string }): ReactNode {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const [busy, setBusy] = useState(false);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    if (await unlink(folderId, name)) closeDialog();
    else setBusy(false);
  };

  return (
    <Dialog
      title="Unlink folder?"
      onClose={closeDialog}
      footer={
        <>
          <Button onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Unlinking…' : 'Unlink'}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-[var(--color-text-primary)]">
        Unlink <strong>{name}</strong>? The files stay where they are on disk. TrailRT forgets their locations and
        thumbnails.
      </p>
      <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">You can undo this with Edit › Undo.</p>
    </Dialog>
  );
}
