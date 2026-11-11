import { ChevronLeft, ChevronRight, House, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { ItineraryView, StopView } from "@shared/domain/itinerary";
import type { UnitSystem } from "@shared/domain/types";
import { formatDistance, formatDuration } from "@shared/geo/units";
import type { TimelineDay } from "@shared/itinerary/timeline";
import { addDays } from "@shared/time/zoned";
import { Button } from "../../components/Button";
import { api, call, describeError } from "../../lib/client";
import { useItineraryStore } from "../../stores/itineraryStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import {
  blockDate,
  calendarBlocks,
  dayBounds,
  monthGrid,
  placeDay,
  snapDuration,
  unknownBlocks,
  weekDates,
  type CalendarBlock,
  type PlacedBlock,
} from "./calendarLayout";
import { dayText } from "./viewModel";

/**
 * The calendar drawer below the map. Phase 10 Requirement 4, design §11.2.
 *
 * Day, week and month views of the main process's timeline. Selecting a
 * block selects its route or waypoint, so the map shows it; selecting a stop
 * elsewhere brings its day into view. The bottom edge of a stop can be dragged
 * to change its duration, through the same undoable command as the editor.
 */

type Mode = "day" | "week" | "month";

const HOUR_PX = 28;
const NARROW_PX = 640;

export function CalendarPanel({ tripId, onClose }: { tripId: string; onClose: () => void }): ReactNode {
  const view = useItineraryStore((s) => (s.tripId === tripId ? s.view : null));
  const units = useSettingsStore((s) => s.settings.units);
  const selected = useSelectionStore((s) => s.selected);
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const panel = useRef<HTMLElement | null>(null);

  const blocks = useMemo(() => (view === null ? [] : calendarBlocks(view)), [view]);
  const zone = view?.timeline.calendarZone ?? "UTC";
  const date = anchor ?? view?.itinerary.startDate ?? "";

  // Below 640 px the week becomes a list of days.
  useEffect(() => {
    const element = panel.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? 1000) < NARROW_PX));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The grid starts at midnight, so the first thing in view is scrolled to
  // when the trip, the view or the dates change. Not on every edit, which
  // would undo the user's own scrolling.
  const loaded = view !== null;
  useEffect(() => {
    const element = panel.current;
    if (element === null || !loaded || mode === "month") return;
    const first = [...element.querySelectorAll<HTMLElement>('[data-date] [data-testid="block-stop"], [data-date] [data-testid="block-leg"]')]
      .map((b) => b.getBoundingClientRect().top)
      .toSorted((a, b) => a - b)[0];
    if (first === undefined) return;
    const header = element.querySelector<HTMLElement>("[data-calendar-header]")?.offsetHeight ?? 0;
    const top = first - element.getBoundingClientRect().top + element.scrollTop;
    element.scrollTop = Math.max(0, top - header - HOUR_PX);
    // The trip, dates and layout are triggers rather than inputs: each one
    // changes what the DOM holds, which is what the effect reads.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [tripId, loaded, mode, date, narrow]);

  // A stop selected on the map or in the library brings its day into view.
  // Adjusted during render when the selection changes, React's documented
  // pattern for state that follows a prop, rather than in an effect.
  const selectedKey = selected === null ? null : `${selected.kind}:${selected.id}`;
  const [followed, setFollowed] = useState<string | null>(null);
  if (selectedKey !== followed) {
    setFollowed(selectedKey);
    const match = blocks.find((b) => b.ref !== null && `${b.ref.kind}:${b.ref.id}` === selectedKey);
    const day = match === undefined ? null : blockDate(match, zone);
    if (day !== null) setAnchor(day);
  }

  if (view === null) {
    return (
      <section aria-label="Calendar" className="shrink-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 text-[12px] text-[var(--color-text-muted)]">
        This trip has no itinerary. Use “Plan by date” in its properties.
        <Button variant="ghost" className="ml-2" onClick={onClose}>
          Close
        </Button>
      </section>
    );
  }

  const step = mode === "day" ? 1 : mode === "week" ? 7 : 0;
  const move = (direction: 1 | -1): void => {
    if (mode === "month") {
      const [y, m] = date.split("-").map(Number);
      const next = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + direction, 1));
      setAnchor(next.toISOString().slice(0, 10));
    } else {
      setAnchor(addDays(date, direction * step));
    }
  };
  const unknown = unknownBlocks(blocks);
  const days = new Map(view.timeline.days.map((d) => [d.date, d]));

  return (
    <section
      ref={panel}
      aria-label="Calendar"
      data-testid="calendar"
      className="h-full overflow-y-auto bg-[var(--color-surface)]"
    >
      <div data-calendar-header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2">
        <h2 className="text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">Calendar</h2>
        <div role="group" aria-label="Calendar view" className="flex gap-1">
          {(["day", "week", "month"] as const).map((m) => (
            <Button key={m} variant={mode === m ? "primary" : "default"} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m[0]?.toUpperCase()}
              {m.slice(1)}
            </Button>
          ))}
        </div>
        <IconButton variant="ghost" hint="Earlier" onClick={() => move(-1)}>
          <ChevronLeft size={16} aria-hidden="true" />
        </IconButton>
        <span className="text-[12px] text-[var(--color-text-primary)]" data-testid="calendar-range">
          {mode === "month" ? monthLabel(date) : mode === "day" ? dayText(date) : `${dayText(weekDates(date)[0] ?? date)} – ${dayText(weekDates(date)[6] ?? date)}`}
        </span>
        <IconButton variant="ghost" hint="Later" onClick={() => move(1)}>
          <ChevronRight size={16} aria-hidden="true" />
        </IconButton>
        <IconButton variant="ghost" hint="Go to the start of the trip" onClick={() => setAnchor(view.itinerary.startDate)}>
          <House size={16} aria-hidden="true" />
        </IconButton>
        {!view.timeline.calendarZoneKnown && (
          <span className="text-[11px] text-[var(--color-text-muted)]">Times shown in {zone}: the first stop’s zone is not known.</span>
        )}
        <IconButton variant="ghost" className="ml-auto" hint="Close calendar" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>

      {unknown.length > 0 && (
        <div className="border-b border-[var(--color-border-subtle)] p-2 text-[12px]" data-testid="calendar-unknown">
          <p className="mb-1 text-[var(--color-text-muted)]">Times unknown until every drive has a route:</p>
          <div className="flex flex-wrap gap-1">
            {unknown.map((block) => (
              <BlockChip key={block.key} block={block} />
            ))}
          </div>
        </div>
      )}

      <div className="p-2">
        {mode === "month" ? (
          <MonthView date={date} blocks={blocks} zone={zone} days={days} units={units} onPick={(d) => { setAnchor(d); setMode("day"); }} />
        ) : mode === "week" && narrow ? (
          <DayList dates={weekDates(date)} blocks={blocks} zone={zone} days={days} units={units} />
        ) : (
          <TimeGrid dates={mode === "day" ? [date] : weekDates(date)} blocks={blocks} zone={zone} days={days} units={units} view={view} />
        )}
      </div>
    </section>
  );
}

function monthLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function selectBlock(block: CalendarBlock): void {
  if (block.ref !== null) void useSelectionStore.getState().select(block.ref);
}

function isSelected(block: CalendarBlock, selected: { kind: string; id: string } | null): boolean {
  return selected !== null && block.ref !== null && block.ref.kind === selected.kind && block.ref.id === selected.id;
}

function DaySummary({ day, view, units }: { day: TimelineDay | undefined; view?: ItineraryView; units: UnitSystem }): ReactNode {
  if (day === undefined) return null;
  const night = view?.stops.find((s) => s.id === day.nightStopId)?.place?.name ?? null;
  return (
    <p className="truncate text-[11px] text-[var(--color-text-muted)]" data-testid="day-summary">
      {day.driveSeconds > 0 ? `${formatDistance(day.driveDistanceM, units)} · ${formatDuration(day.driveSeconds)} driving` : "No driving"}
      {night !== null && ` · night: ${night}`}
      {day.incomplete && " · partly unknown"}
      {day.overDailyCap && <span className="text-[var(--color-danger)]"> · over your daily limit</span>}
    </p>
  );
}

function BlockChip({ block }: { block: CalendarBlock }): ReactNode {
  const selected = useSelectionStore((s) => s.selected);
  return (
    <button
      type="button"
      onClick={() => selectBlock(block)}
      className={`rounded px-1.5 py-0.5 text-left text-[11px] ${chipClass(block)} ${isSelected(block, selected) ? "outline-2 outline-[var(--color-accent)]" : ""}`}
    >
      {block.label}
    </button>
  );
}

/** Drives are filled; stops are outlined. The two never look alike. */
function chipClass(block: CalendarBlock): string {
  return block.kind === "leg"
    ? "bg-[var(--color-accent)] text-white"
    : "border border-[var(--color-accent)] bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]";
}

function TimeGrid({
  dates,
  blocks,
  zone,
  days,
  units,
  view,
}: {
  dates: string[];
  blocks: CalendarBlock[];
  zone: string;
  days: Map<string, TimelineDay>;
  units: UnitSystem;
  view: ItineraryView;
}): ReactNode {
  return (
    <div className="flex min-w-0 gap-1 overflow-x-auto">
      <div className="w-9 shrink-0 pt-12 text-right text-[10px] text-[var(--color-text-muted)]">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} style={{ height: HOUR_PX * 2 }}>
            {String(i * 2).padStart(2, "0")}:00
          </div>
        ))}
      </div>
      {dates.map((date) => (
        <DayColumn key={date} date={date} blocks={blocks} zone={zone} day={days.get(date)} units={units} view={view} />
      ))}
    </div>
  );
}

function DayColumn({
  date,
  blocks,
  zone,
  day,
  units,
  view,
}: {
  date: string;
  blocks: CalendarBlock[];
  zone: string;
  day: TimelineDay | undefined;
  units: UnitSystem;
  view: ItineraryView;
}): ReactNode {
  const { start, end } = dayBounds(date, zone);
  const hours = (end - start) / 3_600_000;
  const height = HOUR_PX * hours;
  const placed = placeDay(blocks, date, zone);
  return (
    <div className="min-w-[7.5rem] flex-1" data-testid="calendar-day" data-date={date}>
      <div className="h-12 overflow-hidden px-1">
        <p className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">{dayText(date)}</p>
        {hours !== 24 && (
          <p className="truncate text-[10px] text-[var(--color-text-muted)]">{hours}-hour day: the clocks change</p>
        )}
        <DaySummary day={day} view={view} units={units} />
      </div>
      <div
        className="relative rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)]"
        style={{ height, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX * 2 - 1}px, var(--color-border-subtle) ${HOUR_PX * 2 - 1}px, var(--color-border-subtle) ${HOUR_PX * 2}px)` }}
      >
        {placed.map((p) => (
          <PlacedBlockView key={p.block.key} placed={p} dayHeightPx={height} dayMinutes={hours * 60} stop={view.stops[p.block.stopIndex]} />
        ))}
      </div>
    </div>
  );
}

function PlacedBlockView({
  placed,
  dayHeightPx,
  dayMinutes,
  stop,
}: {
  placed: PlacedBlock;
  dayHeightPx: number;
  dayMinutes: number;
  stop: StopView | undefined;
}): ReactNode {
  const selected = useSelectionStore((s) => s.selected);
  const [dragPx, setDragPx] = useState(0);
  const origin = useRef<number | null>(null);
  const { block } = placed;
  const width = 100 / placed.lanes;
  const canDrag = block.resizable && !placed.continuesAfter && stop !== undefined;

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
    const deltaMinutes = (dragPx / dayHeightPx) * dayMinutes;
    setDragPx(0);
    const patch = snapDuration(stop, deltaMinutes);
    const unchanged =
      ("durationMinutes" in patch && patch.durationMinutes === stop.durationMinutes) ||
      ("durationDays" in patch && patch.durationDays === stop.durationDays);
    if (unchanged) return;
    void call(api().itinerary.updateStop({ id: stop.id, ...patch }))
      .then(() => useItineraryStore.getState().reload())
      .catch((cause: unknown) => useUiStore.getState().showToast(describeError(cause), "error"));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${block.label}${block.detail === "" ? "" : `, ${block.detail}`}`}
      data-testid={`block-${block.kind}`}
      onClick={() => selectBlock(block)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectBlock(block);
        }
      }}
      className={`absolute overflow-hidden rounded px-1 text-[11px] leading-tight ${chipClass(block)} ${isSelected(block, selected) ? "z-[1] outline-2 outline-[var(--color-text-primary)]" : ""}`}
      style={{
        top: `${placed.top * 100}%`,
        height: `calc(${placed.height * 100}% + ${dragPx}px)`,
        left: `${placed.lane * width}%`,
        width: `calc(${width}% - 2px)`,
        minHeight: 4,
      }}
    >
      <span className="block truncate font-medium">{block.label}</span>
      {block.detail !== "" && <span className="block truncate opacity-80">{block.detail}</span>}
      {canDrag && (
        <div
          role="separator"
          aria-label={`Drag to change how long you stay at ${stop.place?.name ?? "this stop"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize bg-[var(--color-accent)] opacity-40 hover:opacity-80"
          data-testid="block-resize"
        />
      )}
    </div>
  );
}

function DayList({
  dates,
  blocks,
  zone,
  days,
  units,
}: {
  dates: string[];
  blocks: CalendarBlock[];
  zone: string;
  days: Map<string, TimelineDay>;
  units: UnitSystem;
}): ReactNode {
  return (
    <ol className="flex flex-col gap-2">
      {dates.map((date) => {
        const placed = placeDay(blocks, date, zone);
        return (
          <li key={date} data-testid="calendar-day" data-date={date}>
            <p className="text-[12px] font-medium text-[var(--color-text-primary)]">{dayText(date)}</p>
            <DaySummary day={days.get(date)} units={units} />
            <div className="mt-1 flex flex-wrap gap-1">
              {placed.length === 0 ? (
                <span className="text-[11px] text-[var(--color-text-muted)]">Nothing planned</span>
              ) : (
                placed.map((p) => <BlockChip key={p.block.key} block={p.block} />)
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function MonthView({
  date,
  blocks,
  zone,
  days,
  units,
  onPick,
}: {
  date: string;
  blocks: CalendarBlock[];
  zone: string;
  days: Map<string, TimelineDay>;
  units: UnitSystem;
  onPick: (date: string) => void;
}): ReactNode {
  const month = date.slice(0, 7);
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[36rem] grid-cols-7 gap-1 text-[11px]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-1 font-semibold text-[var(--color-text-muted)]">
            {d}
          </div>
        ))}
        {monthGrid(date).flat().map((d) => {
          const starting = blocks.filter((b) => b.kind === "stop" && blockDate(b, zone) === d);
          return (
            <div
              key={d}
              data-testid="calendar-day"
              data-date={d}
              className={`min-h-[4.5rem] rounded border border-[var(--color-border-subtle)] p-1 ${d.startsWith(month) ? "bg-[var(--color-surface-raised)]" : "opacity-50"}`}
            >
              <button type="button" className="font-medium text-[var(--color-text-primary)] hover:underline" onClick={() => onPick(d)}>
                {Number(d.slice(8))}
              </button>
              <DaySummary day={days.get(d)} units={units} />
              <div className="mt-0.5 flex flex-col gap-0.5">
                {starting.map((b) => (
                  <BlockChip key={b.key} block={b} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
