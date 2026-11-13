import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../../components/IconButton';

/**
 * The companion's building blocks, drawn as the mock-ups draw them
 * (`docs/design/library-panel/option-e/`): a raised card with its icon,
 * title and pencil; small capital section labels with a count on the right;
 * and rounded chips for totals.
 */

/** The colours the mock-ups give each kind, shared with the hour scale. */
export const KIND_COLOUR = {
  route: '#7c3aed',
  track: '#ea580c',
  waypoint: '#dc2626',
  photo: '#0d9488',
  folder: '#64748b',
} as const;

export function Card({ children, testId, selected = false }: { children: ReactNode; testId?: string; selected?: boolean }): ReactNode {
  return (
    <div
      data-testid={testId}
      className={`rounded-xl bg-[var(--color-surface-sunken)] p-3 ${selected ? 'outline-2 outline-[var(--color-accent)]' : ''}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  icon,
  title,
  lines,
  onEdit,
  editHint = 'Edit',
}: {
  icon: ReactNode;
  title: string;
  lines: readonly (string | null)[];
  onEdit?: () => void;
  editHint?: string;
}): ReactNode {
  const shown = lines.filter((l): l is string => l !== null && l !== '');
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
        {shown.map((line, i) => (
          <p key={line} className={`truncate text-[12px] ${i === 0 ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`}>
            {line}
          </p>
        ))}
      </div>
      {onEdit !== undefined && (
        <IconButton variant="ghost" hint={editHint} onClick={onEdit}>
          <Pencil size={15} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}

export function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }): ReactNode {
  return (
    <div className="mt-4 mb-1.5 flex items-baseline justify-between gap-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">{children}</h3>
      {aside !== undefined && <span className="text-[11px] text-[var(--color-text-muted)]">{aside}</span>}
    </div>
  );
}

export function Chip({ children }: { children: ReactNode }): ReactNode {
  return <span className="rounded-full bg-[var(--color-surface-sunken)] px-2.5 py-1 text-[12px] text-[var(--color-text-secondary)]">{children}</span>;
}

export function Note({ children }: { children: ReactNode }): ReactNode {
  return <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">{children}</p>;
}
