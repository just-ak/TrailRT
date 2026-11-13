import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../../components/IconButton';
import { useCompanionStore } from '../../stores/companionStore';
import { useItineraryStore } from '../../stores/itineraryStore';
import { useNavStore } from '../../stores/navStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { companionView } from './companionView';
import { ObjectCard } from './ObjectCard';
import { TripView } from './TripView';
import { UndatedPrompt } from './UndatedPrompt';
import { YearView } from './YearView';

function edit(): void {
  useCompanionStore.getState().edit();
}

/**
 * The right panel. Phase 14 Requirement 4 and 5, design §4.3.
 *
 * Its reading state, the companion, answers "when is it, and what is around
 * it" for whatever is selected. The pencil on each card puts today's property
 * editors in front of it, unchanged, with a way back.
 */
export function CompanionPanel(): ReactNode {
  const selected = useSelectionStore((s) => s.selected);
  const openTripId = useNavStore((s) => s.openTripId);
  const section = useNavStore((s) => s.section);
  const editing = useCompanionStore((s) => s.editing);
  const itineraryTrip = useItineraryStore((s) => s.tripId);
  const answered = useItineraryStore((s) => s.answered);
  const dated = useItineraryStore((s) => s.view !== null);

  const view = companionView({ selected, section, openTripId, editing, itinerary: { tripId: itineraryTrip, answered, dated } });

  const editTrip = (tripId: string): void => {
    if (selected?.kind !== 'trip' || selected.id !== tripId) void useSelectionStore.getState().select({ kind: 'trip', id: tripId });
    edit();
  };

  if (view.kind === 'edit') {
    return (
      <div className="flex h-full flex-col" data-testid="companion" data-view="edit">
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border-subtle)] px-2 py-1.5">
          <IconButton variant="ghost" hint="Close the editor" onClick={() => useCompanionStore.getState().back()}>
            <ChevronLeft size={16} aria-hidden="true" />
          </IconButton>
          <span className="text-[12px] text-[var(--color-text-muted)]">Editing</span>
        </div>
        <div className="min-h-0 flex-1">
          <PropertiesPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="companion" data-view={view.kind}>
      {view.kind === 'year' && <YearView />}
      {view.kind === 'loading' && <p className="text-[12px] text-[var(--color-text-muted)]">Loading…</p>}
      {view.kind === 'trip' && <TripView tripId={view.tripId} onEdit={() => editTrip(view.tripId)} />}
      {view.kind === 'undated' && <UndatedPrompt tripId={view.tripId} onEdit={() => editTrip(view.tripId)} />}
      {view.kind === 'object' && <ObjectCard refTo={view.ref} onEdit={edit} />}
    </div>
  );
}
