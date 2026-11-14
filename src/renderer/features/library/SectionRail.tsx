import { Activity, Clock, Images, Inbox, Map as MapIcon, MapPin, Route, Settings } from "lucide-react";
import type { ReactNode } from "react";
import type { LibrarySection } from "@shared/domain/types";
import { IconButton } from "../../components/IconButton";
import { useNavStore } from "../../stores/navStore";
import { useUiStore } from "../../stores/uiStore";

/**
 * The rail at the window's left edge. Phase 14, Requirement 1.
 *
 * Trips hold things; every other section is a view across trips (ADR 0004,
 * ADR 0021). It stays visible when the library is hidden, so the sections are
 * always one click away. A tab list: the arrow keys move between sections.
 */

const SECTIONS: { id: LibrarySection; label: string; icon: ReactNode }[] = [
  { id: "trips", label: "Trips", icon: <MapIcon size={18} aria-hidden="true" /> },
  { id: "routes", label: "Routes", icon: <Route size={18} aria-hidden="true" /> },
  { id: "tracks", label: "Tracks", icon: <Activity size={18} aria-hidden="true" /> },
  { id: "waypoints", label: "Waypoints", icon: <MapPin size={18} aria-hidden="true" /> },
  { id: "photos", label: "Photos", icon: <Images size={18} aria-hidden="true" /> },
  { id: "imported", label: "Imported Data", icon: <Inbox size={18} aria-hidden="true" /> },
];

function choose(id: LibrarySection): void {
  useNavStore.getState().setSection(id);
  // Choosing a section shows the library if it was hidden.
  if (!useUiStore.getState().layout.libraryVisible) useUiStore.getState().toggleLibrary();
}

export function SectionRail(): ReactNode {
  const section = useNavStore((s) => s.section);
  const libraryVisible = useUiStore((s) => s.layout.libraryVisible);

  return (
    <nav
      aria-label="Library sections"
      className="flex h-full w-[52px] shrink-0 flex-col items-center gap-1 border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] py-2"
      data-testid="section-rail"
    >
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="Library sections"
        className="flex flex-col items-center gap-1"
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const index = SECTIONS.findIndex((s) => s.id === section);
          const next = SECTIONS[(index + (event.key === "ArrowDown" ? 1 : -1) + SECTIONS.length) % SECTIONS.length];
          if (next !== undefined) {
            choose(next.id);
            event.currentTarget.querySelector<HTMLElement>(`[data-section="${next.id}"]`)?.focus();
          }
        }}
      >
        {SECTIONS.map((s) => {
          const active = s.id === section && libraryVisible;
          return (
            <IconButton
              key={s.id}
              role="tab"
              aria-selected={active}
              data-section={s.id}
              tabIndex={s.id === section ? 0 : -1}
              variant="ghost"
              hint={s.label}
              onClick={() => choose(s.id)}
              className={`h-9 w-9 ${active ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : ""}`}
            >
              {s.icon}
            </IconButton>
          );
        })}
        <IconButton variant="ghost" hint="Recently Used arrives in a later version" disabled className="h-9 w-9 opacity-50">
          <Clock size={18} aria-hidden="true" />
        </IconButton>
      </div>
      <IconButton
        variant="ghost"
        hint="Settings"
        className="mt-auto h-9 w-9"
        onClick={() => useUiStore.getState().openDialog({ kind: "settings" })}
      >
        <Settings size={18} aria-hidden="true" />
      </IconButton>
    </nav>
  );
}
