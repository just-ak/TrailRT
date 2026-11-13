import { CalendarPlus, ChevronLeft, ChevronRight, Map as MapIcon, Search } from 'lucide-react';
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { ItineraryView, StopView } from '@shared/domain/itinerary';
import type { Photo } from '@shared/domain/linkedFolders';
import type { Track } from '@shared/domain/types';
import { formatDistance, formatDuration } from '@shared/geo/units';
import { blockDate, calendarBlocks, monthGrid, snapDuration, unknownBlocks, type CalendarBlock } from '@shared/itinerary/calendarLayout';
import { tripHours, type DayScale, type ScaleBlock } from '@shared/itinerary/dayScale';
import { formatDateRange } from '@shared/itinerary/format';
import { shortDay } from '@shared/library/tripGroups';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { api, call, describeError } from '../../lib/client';
import { useGeometryStore } from '../../stores/geometryStore';
import { useItineraryStore } from '../../stores/itineraryStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { usePhotoStore } from '../../stores/photoStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { saveToCalendar } from './companionActions';
import { CardTitle, Chip, KIND_COLOUR, Note } from './parts';

/**
 * A dated trip with nothing narrower selected (Requirement 4.2, view 2): its
 * totals, every day side by side by the hour, and the actions Places along
 * the trip and Save to a calendar. The month is a toggle. This replaces the
 * Phase 10 calendar drawer (design §5.2): selecting a block selects its stop
 * or drive, and a stay's bottom edge can be dragged to change it.
 */

const HOUR_PX = 34;
const NO_TRACKS: Track[] = [];
const NO_PHOTOS: Photo[] = [];

type Mode = 'days' | 'month';

function selectBlock(block: CalendarBlock): void {
  if (block.ref !== null) void useSelectionStore.getState().select(block.ref);
}

function isSelected(block: CalendarBlock, selected: { kind: string; id: string } | null): boolean {
  return selected !== null && block.ref !== null && block.ref.kind === selected.kind && block.ref.id === selected.id;
}

export function TripView({ tripId, onEdit }: { tripId: string; onEdit: () => void }): ReactNode {
  const view = useItineraryStore((s) => (s.tripId === tripId ? s.view : null));
  const overview = useLibraryStore((s) => s.overview.find((t) => t.id === tripId) ?? null);
  const tracks = useGeometryStore((s) => (s.tripId === tripId ? (s.geometry?.tracks ?? NO_TRACKS) : NO_TRACKS));
  const photos = usePhotoStore((s) => (s.tripPhotos.tripId === tripId ? s.tripPhotos.photos : NO_PHOTOS));
  const units = useSettingsStore((s) => s.settings.units);
  const openPoiPanel = useUiStore((s) => s.openPoiPanel);
  const [mode, setMode] = useState<Mode>('days');

  const hours = useMemo(() => (view === null ? null : tripHours({ view, tracks, photos })), [view, tracks, photos]);
  if (view === null || hours === null) return null;

  const { timeline } = view;
  const distance = timeline.days.reduce((sum, d) => sum + d.driveDistanceM, 0);
  const driving = timeline.days.reduce((sum, d) => sum + d.driveSeconds, 0);
  const unknown = unknownBlocks(calendarBlocks(view));

  return (
    <div data-testid="trip-view">
      <CardTitle
        icon={<MapIcon size={18} aria-hidden="true" className="text-[var(--color-accent)]" />}
        title={overview?.name ?? 'Trip'}
        lines={[`${formatDateRange(view.itinerary.startDate, timeline.endDate)}${timeline.complete ? '' : ' · times not all known'}`]}
        onEdit={onEdit}
        editHint="Edit the trip"
      />

      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="trip-totals">
        {distance > 0 && <Chip>{formatDistance(distance, units)}{timeline.complete ? '' : ' so far'}</Chip>}
        {driving > 0 && <Chip>{formatDuration(driving)} driving{timeline.complete ? '' : ' so far'}</Chip>}
        {photos.length > 0 && <Chip>{photos.length.toLocaleString('en-GB')} photos</Chip>}
        {timeline.days.some((d) => d.otherSeconds > 0) && <Chip>{formatDuration(timeline.days.reduce((s, d) => s + d.otherSeconds, 0))} other transport</Chip>}
      </div>

      <div role="group" aria-label="Show the trip by" className="mt-3 inline-flex rounded-lg bg-[var(--color-surface-sunken)] p-0.5 text-[12px]">
        {(['days', 'month'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1 ${mode === m ? 'bg-[var(--color-surface)] font-medium text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-secondary)]'}`}
          >
            {m === 'days' ? 'Days' : 'Month'}
          </button>
        ))}
      </div>

      {!timeline.calendarZoneKnown && (
        <Note>Times shown in {timeline.calendarZone}: the first stop’s zone is not known.</Note>
      )}

      {mode === 'days' ? <TripHours view={view} days={hours.days} fromHour={hours.window.fromHour} toHour={hours.window.toHour} /> : <MonthGrid view={view} />}

      {unknown.length > 0 && (
        <div className="mt-2" data-testid="trip-unknown">
          <p className="mb-1 text-[12px] text-[var(--color-text-muted)]">Times unknown until every drive has a route:</p>
          <div className="flex flex-wrap gap-1">
            {unknown.map((block) => (
              <BlockChip key={block.key} block={block} />
            ))}
          </div>
        </div>
      )}

      <Note>Select a day, stop or drive to see it by the hour.</Note>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => openPoiPanel({ kind: 'itinerary', tripId })}>
          <Search size={15} aria-hidden="true" /> Places along the trip
        </Button>
        <Button onClick={() => saveToCalendar(tripId)}>
          <CalendarPlus size={15} aria-hidden="true" /> Save to a calendar
        </Button>
      </div>
    </div>
  );
}

function BlockChip({ block }: { block: CalendarBlock }): ReactNode {
  const selected = useSelectionStore((s) => s.selected);
  return (
    <button
      type="button"
      onClick={() => selectBlock(block)}
      data-testid={`chip-${block.kind}`}
      className={`max-w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] text-[var(--color-text-primary)] ${isSelected(block, selected) ? 'outline-2 outline-[var(--color-accent)]' : ''}`}
      style={{ background: block.kind === 'leg' ? `color-mix(in srgb, ${KIND_COLOUR.route} 22%, transparent)` : 'var(--color-surface-sunken)' }}
    >
      {block.label}
    </button>
  );
}

function TripHours({ view, days, fromHour, toHour }: { view: ItineraryView; days: DayScale[]; fromHour: number; toHour: number }): ReactNode {
  const height = HOUR_PX * (toHour - fromHour);
  const labels = Array.from({ length: toHour - fromHour + 1 }, (_, i) => fromHour + i);
  return (
    <div className="mt-3 flex gap-1 overflow-x-auto pb-1" data-testid="trip-hours">
      <div className="relative w-8 shrink-0" style={{ height: height + 24 }}>
        {labels.map((h) => (
          <span key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-[var(--color-text-muted)]" style={{ top: 24 + (h - fromHour) * HOUR_PX }}>
            {String(h % 24).padStart(2, '0')}
          </span>
        ))}
      </div>
      {days.map((day) => (
        <div key={day.date} className="min-w-[64px] flex-1" data-testid="calendar-day" data-date={day.date}>
          <p className="h-6 truncate text-center text-[12px] font-semibold text-[var(--color-text-primary)]">{shortDay(day.date).split(' ').slice(0, 2).join(' ')}</p>
          <div
            className="relative"
            style={{
              height,
              backgroundImage: `repeating-linear-gradient(to bottom, var(--color-border-subtle) 0, var(--color-border-subtle) 1px, transparent 1px, transparent ${HOUR_PX}px)`,
            }}
          >
            {day.plan.map((p) => (
              <PlacedBlock key={p.block.key} placed={p} heightPx={height} stop={view.stops[p.block.stopIndex]} />
            ))}
            {day.recorded.map((r) => (
              <div
                key={r.trackId}
                title={r.name}
                className="absolute right-0 w-1.5 rounded-sm"
                style={{ top: `${r.top * 100}%`, height: `${r.height * 100}%`, background: KIND_COLOUR.track, opacity: 0.6 }}
              />
            ))}
            {day.photos.map((photo) => (
              <span
                key={photo.id}
                data-testid="photo-time"
                className="absolute right-2.5 h-[7px] w-[7px] -translate-y-1/2 rounded-full"
                style={{ top: `${photo.top * 100}%`, background: KIND_COLOUR.photo }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One stop or drive on the scale, full width at its real times, as the
 * mock-ups draw them: stays underneath, drives on top as bars, and a
 * departure or arrival with no length as a thin marker. A stay's bottom edge
 * drags to change it (Phase 10 Requirement 4.4).
 */
function PlacedBlock({ placed, heightPx, stop }: { placed: ScaleBlock; heightPx: number; stop: StopView | undefined }): ReactNode {
  const selected = useSelectionStore((s) => s.selected);
  const [dragPx, setDragPx] = useState(0);
  const origin = useRef<number | null>(null);
  const { block } = placed;
  const canDrag = block.resizable && !placed.continuesAfter && stop !== undefined;
  const chosen = isSelected(block, selected);
  const leg = block.kind === 'leg';
  const instant = !leg && placed.exactHeight === 0;
  const tallPx = placed.exactHeight * heightPx;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    origin.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (origin.current !== null) setDragPx(event.clientY - origin.current);
  };
  const onPointerUp = (): void => {
    if (origin.current === null || stop === undefined) return;
    origin.current = null;
    const deltaMinutes = (dragPx / HOUR_PX) * 60;
    setDragPx(0);
    const patch = snapDuration(stop, deltaMinutes);
    const unchanged =
      ('durationMinutes' in patch && patch.durationMinutes === stop.durationMinutes) ||
      ('durationDays' in patch && patch.durationDays === stop.durationDays);
    if (unchanged) return;
    void call(api().itinerary.updateStop({ id: stop.id, ...patch }))
      .then(() => useItineraryStore.getState().reload())
      .catch((cause: unknown) => useUiStore.getState().showToast(describeError(cause), 'error'));
  };

  const background = chosen
    ? 'var(--color-accent)'
    : leg
      ? `color-mix(in srgb, ${KIND_COLOUR.route} 30%, var(--color-surface))`
      : instant
        ? KIND_COLOUR.waypoint
        : 'var(--color-surface-sunken)';
  const height = instant ? '3px' : `max(${leg ? 10 : 6}px, calc(${placed.exactHeight * 100}% + ${dragPx}px))`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${block.label}${block.detail === '' ? '' : `, ${block.detail}`}`}
      aria-pressed={chosen}
      data-testid={`block-${block.kind}`}
      title={block.label}
      onClick={() => selectBlock(block)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectBlock(block);
        }
      }}
      className={`absolute right-3.5 left-0 overflow-hidden rounded-md px-1.5 text-[10px] leading-tight ${chosen ? 'text-white' : 'text-[var(--color-text-primary)]'} ${leg ? 'z-[2]' : instant ? 'z-[1] -translate-y-1/2' : ''}`}
      style={{ top: `${placed.exactTop * 100}%`, height, background }}
    >
      {!instant && tallPx >= 13 && <span className="block truncate pt-0.5 font-medium">{leg ? block.label.replace(/^Drive to /, 'Drive · ') : block.label}</span>}
      {canDrag && (
        <div
          role="separator"
          aria-label={`Drag to change how long you stay at ${stop.place?.name ?? 'this stop'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize bg-[var(--color-accent)] opacity-0 hover:opacity-60"
          data-testid="block-resize"
        />
      )}
    </div>
  );
}

function monthLabel(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function shiftMonth(date: string, by: number): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + by, 1)).toISOString().slice(0, 10);
}

/** The month the trip starts in, with the trip's days tinted and what starts on each. */
function MonthGrid({ view }: { view: ItineraryView }): ReactNode {
  const [anchor, setAnchor] = useState(view.itinerary.startDate);
  const blocks = useMemo(() => calendarBlocks(view), [view]);
  const zone = view.timeline.calendarZone;
  const tripDays = new Set(view.timeline.days.map((d) => d.date));
  const month = anchor.slice(0, 7);
  return (
    <div className="mt-3" data-testid="trip-month">
      <div className="mb-1 flex items-center gap-1">
        <IconButton variant="ghost" hint="The month before" onClick={() => setAnchor(shiftMonth(anchor, -1))}>
          <ChevronLeft size={15} aria-hidden="true" />
        </IconButton>
        <span className="flex-1 text-center text-[13px] font-medium text-[var(--color-text-primary)]" data-testid="month-label">
          {monthLabel(anchor)}
        </span>
        <IconButton variant="ghost" hint="The month after" onClick={() => setAnchor(shiftMonth(anchor, 1))}>
          <ChevronRight size={15} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[10px]">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- the weekday letters repeat
          <span key={i} className="text-center font-semibold text-[var(--color-text-muted)]">
            {d}
          </span>
        ))}
        {monthGrid(anchor)
          .flat()
          .map((d) => {
            const starting = blocks.filter((b) => b.kind === 'stop' && blockDate(b, zone) === d);
            return (
              <div
                key={d}
                data-testid="calendar-day"
                data-date={d}
                className={`min-h-[3.25rem] overflow-hidden rounded p-0.5 ${d.startsWith(month) ? '' : 'opacity-40'}`}
                style={{ background: tripDays.has(d) ? `color-mix(in srgb, var(--color-accent) 14%, transparent)` : 'var(--color-surface-sunken)' }}
              >
                <span className="block text-[var(--color-text-secondary)]">{Number(d.slice(8))}</span>
                {starting.slice(0, 2).map((b) => (
                  <BlockChip key={b.key} block={b} />
                ))}
                {starting.length > 2 && <span className="text-[var(--color-text-muted)]">+{starting.length - 2}</span>}
              </div>
            );
          })}
      </div>
    </div>
  );
}
