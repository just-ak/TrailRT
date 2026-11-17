import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { filterDestinations, isPickerKey, moveHighlight, type Destination } from "./tripPicker";

interface Props {
  /** The dialog's title, such as "Move 3 Objects to a Trip". */
  title: string;
  destinations: readonly Destination[];
  onPick: (id: string) => void;
  onClose: () => void;
}

/**
 * Move to Trip… (Phase 14 Requirement 21): every trip, in a list that
 * scrolls under a filter, which takes the library search's patterns. The
 * arrow keys move the highlight, Return picks it, Escape is the dialog's own
 * cancel. A long list here is hundreds of trips, so it is not virtualised.
 */
export function TripPickerDialog({ title, destinations, onPick, onClose }: Props): ReactNode {
  const [filter, setFilter] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => filterDestinations(destinations, filter), [destinations, filter]);
  const items = filtered.ok ? filtered.items : [];
  const active = items[Math.min(highlight, items.length - 1)];

  useEffect(() => {
    if (active === undefined) return;
    listRef.current?.querySelector(`[data-id="${CSS.escape(active.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const optionId = (id: string): string => `${listId}-${id}`;

  return (
    <Dialog
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <input
        type="text"
        role="combobox"
        aria-label="Filter trips"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active === undefined ? undefined : optionId(active.id)}
        // Requirement 21.2: the focus is in the filter when the list opens.
        autoFocus
        spellCheck={false}
        value={filter}
        placeholder="Filter (pattern)"
        onChange={(event) => {
          setFilter(event.target.value);
          // The top match is highlighted again whenever the filter changes.
          setHighlight(0);
        }}
        onKeyDown={(event) => {
          if (isPickerKey(event.key)) {
            event.preventDefault();
            setHighlight((index) => moveHighlight(index, event.key as Parameters<typeof moveHighlight>[1], items.length));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (active !== undefined) onPick(active.id);
          }
        }}
        className="mb-2 w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
      />
      {!filtered.ok ? (
        <p role="alert" className="px-1 py-2 text-[12px] text-[var(--color-text-secondary)]">
          <span className="font-semibold text-[var(--color-danger)]">Not a valid pattern.</span> {filtered.message}.
        </p>
      ) : items.length === 0 ? (
        <p className="px-1 py-2 text-[12px] text-[var(--color-text-muted)]">No trip matches.</p>
      ) : (
        <p className="px-1 pb-1 text-[11px] text-[var(--color-text-muted)]">
          {items.length === destinations.length ? `${items.length} trips` : `${items.length} of ${destinations.length} trips`}
        </p>
      )}
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Trips"
        className="max-h-[44vh] overflow-y-auto rounded-md border border-[var(--color-border-subtle)]"
        hidden={items.length === 0}
      >
        {items.map((destination) => {
          const selected = destination.id === active?.id;
          return (
            <li
              key={destination.id}
              id={optionId(destination.id)}
              data-id={destination.id}
              role="option"
              aria-selected={selected}
              onMouseMove={() => setHighlight(items.indexOf(destination))}
              // mousedown, so the filter keeps the focus.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(destination.id)}
              className={`cursor-default truncate px-2.5 py-1.5 text-[13px] ${
                selected ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-primary)]"
              }`}
            >
              {destination.name}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
