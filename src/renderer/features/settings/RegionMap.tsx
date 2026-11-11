import { useMemo, useState, type ReactNode } from "react";
import type { RegionMapEntry } from "@shared/routing/results";
import {
  ENGLAND_WALES_VIEW,
  projectRegions,
  UK_VIEW,
  type MapView,
} from "@shared/geo/regionMap";

/**
 * The UK county map in the region picker. ADR 0018.
 *
 * Inline SVG drawn from the region index's own outlines, so it needs no tiles,
 * no network beyond the index the picker already loads, and nothing that could
 * fail to render. Every region is a checkbox: clickable, focusable, and
 * toggled with Space or Enter, because a map of fifty shapes must still be
 * usable without a pointer.
 *
 * Neighbouring outlines overlap a little, because Geofabrik buffers them. The
 * click goes to the shape on top, and the name shown on hover says which that
 * is, so an overlap can never select something silently.
 */

const WIDTH = 420;
/** Short enough to sit inside the dialog without scrolling on a laptop screen. */
const HEIGHT = 440;

const VIEWS: { id: string; label: string; view: MapView }[] = [
  { id: "uk", label: "Whole UK", view: UK_VIEW },
  { id: "ew", label: "England and Wales", view: ENGLAND_WALES_VIEW },
];

export function RegionMap({
  regions,
  selected,
  disabled,
  onToggle,
}: {
  regions: readonly RegionMapEntry[];
  selected: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (id: string) => void;
}): ReactNode {
  const [viewId, setViewId] = useState("ew");
  const [hovered, setHovered] = useState<string | null>(null);
  const view = VIEWS.find((v) => v.id === viewId)?.view ?? UK_VIEW;

  const projected = useMemo(
    () => projectRegions(regions, view, WIDTH, HEIGHT),
    [regions, view],
  );
  const byId = useMemo(
    () => new Map(regions.map((region) => [region.id, region])),
    [regions],
  );

  // Selected regions drawn last, so their outline is never hidden under a
  // neighbour's overlapping edge.
  const ordered = useMemo(
    () =>
      projected.toSorted(
        (a, b) => Number(selected.has(a.id)) - Number(selected.has(b.id)),
      ),
    [projected, selected],
  );

  const hoveredRegion = hovered === null ? null : (byId.get(hovered) ?? null);

  return (
    <div className="relative">
      <div className="mb-2 flex gap-1" role="group" aria-label="Map view">
        {VIEWS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={viewId === option.id}
            onClick={() => setViewId(option.id)}
            className={`rounded-md border px-2 py-0.5 text-[11px] ${
              viewId === option.id
                ? "border-[var(--color-accent)] text-[var(--color-text-primary)]"
                : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="group"
        aria-label="Map of downloadable UK regions"
        className="block rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)]"
        style={{ maxHeight: HEIGHT }}
        onPointerLeave={() => setHovered(null)}
      >
        {ordered.map((shape) => {
          const region = byId.get(shape.id);
          if (region === undefined) return null;
          const isSelected = selected.has(shape.id);
          return (
            <path
              key={shape.id}
              d={shape.d}
              role="checkbox"
              aria-checked={isSelected}
              aria-label={region.loaded ? `${region.name}, loaded` : region.name}
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : 0}
              data-region={shape.id}
              fill={isSelected ? "var(--color-accent)" : "var(--color-surface)"}
              fillOpacity={isSelected ? 0.55 : 1}
              stroke={
                region.loaded
                  ? "var(--color-text-primary)"
                  : "var(--color-text-muted)"
              }
              strokeWidth={region.loaded ? 1.6 : 0.6}
              strokeLinejoin="round"
              className={`outline-none ${
                disabled ? "cursor-not-allowed" : "cursor-pointer"
              } focus-visible:stroke-[var(--color-accent)]`}
              onPointerEnter={() => setHovered(shape.id)}
              onFocus={() => setHovered(shape.id)}
              onClick={() => {
                if (!disabled) onToggle(shape.id);
              }}
              onKeyDown={(event) => {
                if (disabled) return;
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  onToggle(shape.id);
                }
              }}
            />
          );
        })}
      </svg>

      <p
        className="mt-1 h-4 text-[11px] text-[var(--color-text-secondary)]"
        aria-live="polite"
      >
        {hoveredRegion === null
          ? "Click a region to add or remove it."
          : `${hoveredRegion.name}${hoveredRegion.loaded ? " · loaded" : ""}${
              selected.has(hoveredRegion.id) ? " · selected" : ""
            }`}
      </p>
    </div>
  );
}
