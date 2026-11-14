import { FolderSearch, Images, RefreshCw, Unlink, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LinkedFolderSummary } from '@shared/domain/linkedFolders';
import { formatTimestamp } from '@shared/geo/units';
import { fileCountLines, photoStateLines, STATE_TEXT } from '@shared/photos/library';
import { IconButton } from '../../components/IconButton';
import { usePhotoStore } from '../../stores/photoStore';
import { askToUnlink, cancelScan, relink, rescan, setIncludeSubfolders, showPhotos } from './photoActions';

/**
 * A linked folder's properties (design §8.1): where it is, whether it is
 * there, what is in it, and Rescan, Relink, Unlink and Include subfolders.
 * Files this phase lists but does not read (GPX, video) are counted here
 * and say so, rather than looking ignored (Requirement 3.8).
 */

function Section({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="mb-3">
      <p className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">{label}</p>
      {children}
    </div>
  );
}

export function LinkedFolderProperties({ folder }: { folder: LinkedFolderSummary }): ReactNode {
  const progress = usePhotoStore((s) => s.progress[folder.id] ?? null);
  const scanning = folder.state === 'scanning' || progress !== null;
  const state = scanning ? 'scanning' : folder.state;
  const outcome = folder.lastOutcome;

  return (
    <div className="h-full overflow-y-auto p-3" data-testid="linked-folder-properties">
      <h2 className="mb-3 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        Linked folder
      </h2>

      <Section label="Name">
        <p className="text-[13px] text-[var(--color-text-primary)]">{folder.name}</p>
        <p className="mt-0.5 text-[11px] break-all text-[var(--color-text-muted)]">{folder.displayPath}</p>
      </Section>

      <Section label="Status">
        <p className="text-[13px] text-[var(--color-text-primary)]" data-testid="linked-folder-state">
          {state === null ? 'Waiting to scan' : STATE_TEXT[state]}
        </p>
        {progress !== null && (
          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
            {progress.phase === 'walking'
              ? `Looking through the folder: ${progress.seen.toLocaleString('en-GB')} files found`
              : `Reading photos: ${progress.read.toLocaleString('en-GB')}${progress.total === undefined ? '' : ` of ${progress.total.toLocaleString('en-GB')}`}`}
          </p>
        )}
        {outcome?.status === 'partial' && (
          <p className="mt-0.5 text-[11px] text-[var(--color-danger)]">
            The last scan could not finish: {outcome.reason} Nothing was removed.
          </p>
        )}
        {outcome !== null && 'skipped' in outcome && outcome.skipped.unreadableFolders > 0 && (
          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
            {outcome.skipped.unreadableFolders} subfolder{outcome.skipped.unreadableFolders === 1 ? '' : 's'} could not
            be read.
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          {folder.lastScanAt === null ? 'Not scanned yet' : `Last scanned ${formatTimestamp(folder.lastScanAt)}`}
        </p>
      </Section>

      <Section label="Contents">
        <ul className="text-[13px] text-[var(--color-text-primary)]" data-testid="linked-folder-files">
          {fileCountLines(folder.files).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {photoStateLines(folder.photos).length > 0 && (
          <ul className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
            {photoStateLines(folder.photos).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section label="Options">
        <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
          <input
            type="checkbox"
            checked={folder.includeSubfolders}
            onChange={(event) => void setIncludeSubfolders(folder.id, event.target.checked)}
          />
          Include subfolders
        </label>
      </Section>

      <div className="mt-2 flex flex-wrap gap-1.5" data-testid="linked-folder-actions">
        <IconButton hint="Show the photos in a list" onClick={() => showPhotos(folder.id)}>
          <Images size={16} aria-hidden="true" />
        </IconButton>
        {scanning ? (
          <IconButton hint="Stop scanning. What was read is kept." onClick={() => void cancelScan(folder.id)}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        ) : (
          <IconButton hint="Rescan the folder for changes" onClick={() => void rescan(folder.id)}>
            <RefreshCw size={16} aria-hidden="true" />
          </IconButton>
        )}
        <IconButton hint="Relink: choose where the folder is now" onClick={() => void relink(folder.id)}>
          <FolderSearch size={16} aria-hidden="true" />
        </IconButton>
        <IconButton hint="Unlink the folder. Its files are not touched." onClick={() => askToUnlink(folder.id, folder.name)}>
          <Unlink size={16} aria-hidden="true" />
        </IconButton>
      </div>

      <p className="mt-4 text-[11px] text-[var(--color-text-muted)]">
        TrailRT reads this folder and never changes, moves or adds anything in it.
      </p>
    </div>
  );
}
