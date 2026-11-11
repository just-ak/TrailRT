import type { ReactNode } from 'react';
import { CANDIDATE_COLOURS, type CandidateSummary } from './candidates';

/**
 * The routes on offer for one leg, as a list beside the map. Phase 6,
 * Requirement 1.3–1.4.
 *
 * The list and the map lines are two views of one choice: hovering a row
 * highlights its line and the reverse, and the keys 1–3 work in both.
 * `actions` is present for a saved route, where a choice has to be confirmed;
 * in the snap routing tool the next click accepts the selection instead.
 */
interface Props {
  summaries: readonly CandidateSummary[];
  selected: number;
  hovered: number | null;
  selectedColour: string;
  busy: boolean;
  /** Shown under the heading, e.g. why the choice is not yet confirmed. */
  note?: string | null;
  onSelect: (index: number) => void;
  onHover: (index: number | null) => void;
  actions?: { onUse: () => void; onCancel: () => void } | undefined;
}

export function CandidateList(props: Props): ReactNode {
  const { summaries, selected, hovered, selectedColour, busy, note, onSelect, onHover, actions } =
    props;
  const only = summaries.length === 1;

  return (
    <div
      role="group"
      aria-label="Routes on offer for this section"
      className="absolute top-28 right-3 z-[650] w-72 max-w-[calc(100%-1.5rem)] rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2 text-[12px] text-[var(--color-text-primary)] shadow-lg"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2 px-1">
        <strong className="text-[12px]">Routes for this section</strong>
        <span className="text-[11px] text-[var(--color-text-muted)]">keys 1–{summaries.length}</span>
      </div>
      {only && (
        <p className="mb-1 px-1 text-[11px] text-[var(--color-text-secondary)]">
          No alternative route was found. This is the only road route the engine offers.
        </p>
      )}
      {note !== null && note !== undefined && (
        <p className="mb-1 px-1 text-[11px] text-[var(--color-text-secondary)]">{note}</p>
      )}
      <ul className="flex flex-col gap-1">
        {summaries.map((s, i) => {
          const colour = i === selected ? selectedColour : (CANDIDATE_COLOURS[i] ?? '#64748b');
          const id = `candidate-${s.letter}`;
          return (
            <li key={s.letter}>
              <label
                htmlFor={id}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                className={`flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 ${
                  i === hovered || i === selected ? 'bg-[var(--color-surface-raised,rgba(0,0,0,0.05))]' : ''
                }`}
              >
                <input
                  id={id}
                  type="radio"
                  name="route-candidate"
                  checked={i === selected}
                  disabled={busy}
                  onChange={() => onSelect(i)}
                  className="mt-0.5"
                />
                <span
                  aria-hidden="true"
                  className="mt-1 inline-block h-1 w-4 shrink-0 rounded"
                  style={{ background: colour }}
                />
                <span className="flex min-w-0 flex-col">
                  <span>
                    <strong>{s.letter}</strong> · {s.distance} · {s.duration}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-secondary)]">
                    {s.delta === null ? "Engine's preferred route" : `${s.delta} vs A`}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {actions !== undefined && (
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={actions.onCancel}
            disabled={busy}
            className="rounded border border-[var(--color-border-subtle)] px-2 py-0.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={actions.onUse}
            disabled={busy}
            className="rounded bg-[var(--color-accent,#2563eb)] px-2 py-0.5 font-semibold text-white"
          >
            {busy ? 'Checking…' : `Use route ${summaries[selected]?.letter ?? ''}`}
          </button>
        </div>
      )}
    </div>
  );
}
