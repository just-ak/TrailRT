import { useState, type ReactNode } from 'react';
import type { ChosenFolder } from '@shared/domain/linkedFolders';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useUiStore } from '../../stores/uiStore';
import { confirmLink } from './photoActions';

/**
 * Confirms a folder the user chose (design §4.1, Requirements 1.1 and 1.3).
 * It names the folder and the trip, and says plainly that TrailRT reads the
 * folder and never changes it.
 */
export function LinkFolderDialog({ tripName, chosen }: { tripName: string; chosen: ChosenFolder }): ReactNode {
  const closeDialog = useUiStore((s) => s.closeDialog);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [busy, setBusy] = useState(false);

  const link = async (): Promise<void> => {
    setBusy(true);
    if (await confirmLink(chosen.token, includeSubfolders)) closeDialog();
    else setBusy(false);
  };

  return (
    <Dialog
      title="Link folder to trip"
      onClose={closeDialog}
      footer={
        <>
          <Button onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void link()} disabled={busy}>
            {busy ? 'Linking…' : 'Link'}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-[var(--color-text-primary)]">
        Link <strong>{chosen.name}</strong> to <strong>{tripName}</strong>?
      </p>
      <p className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]" title={chosen.displayPath}>
        {chosen.displayPath}
      </p>
      <label className="mt-3 flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
        <input
          type="checkbox"
          checked={includeSubfolders}
          onChange={(event) => setIncludeSubfolders(event.target.checked)}
        />
        Include subfolders
      </label>
      <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]">
        TrailRT reads the photos in this folder for where and when they were taken, and lists the GPX and video
        files beside them. It never changes, moves or adds anything in the folder. Photos stay where they are.
      </p>
      {chosen.warnings.map((warning) => (
        <p key={warning} className="mt-2 text-[12px] text-[var(--color-danger)]">
          {warning}
        </p>
      ))}
    </Dialog>
  );
}
