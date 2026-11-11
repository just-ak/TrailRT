import type { ReactNode } from "react";
import { PanelBottom, PanelBottomClose, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { useUiStore } from "../../stores/uiStore";

/**
 * Show and hide the library, the properties panel and the panel below the
 * map. Phase 10 Requirement 16.2. The same as the View menu's items, where
 * they can be seen.
 */
export function PanelToggles(): ReactNode {
  const layout = useUiStore((s) => s.layout);
  const somethingBelow = useUiStore((s) => s.profile !== null || s.planDrawer !== null);
  const toggleLibrary = useUiStore((s) => s.toggleLibrary);
  const toggleProperties = useUiStore((s) => s.toggleProperties);
  const toggleDrawer = useUiStore((s) => s.toggleDrawer);
  const bottomShown = layout.drawerVisible !== false;

  return (
    <div
      role="group"
      aria-label="Panels"
      className="absolute bottom-12 left-3 z-[500] flex gap-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-1 shadow-md"
      data-testid="panel-toggles"
    >
      <IconButton
        variant="ghost"
        hint={layout.libraryVisible ? "Hide the library" : "Show the library"}
        aria-pressed={layout.libraryVisible}
        onClick={toggleLibrary}
      >
        {layout.libraryVisible ? <PanelLeftClose size={16} aria-hidden="true" /> : <PanelLeft size={16} aria-hidden="true" />}
      </IconButton>
      <IconButton
        variant="ghost"
        hint={!somethingBelow ? "Nothing is open below the map" : bottomShown ? "Hide the panel below the map" : "Show the panel below the map"}
        aria-pressed={bottomShown}
        disabled={!somethingBelow}
        onClick={toggleDrawer}
      >
        {bottomShown ? <PanelBottomClose size={16} aria-hidden="true" /> : <PanelBottom size={16} aria-hidden="true" />}
      </IconButton>
      <IconButton
        variant="ghost"
        hint={layout.propertiesVisible ? "Hide the properties" : "Show the properties"}
        aria-pressed={layout.propertiesVisible}
        onClick={toggleProperties}
      >
        {layout.propertiesVisible ? <PanelRightClose size={16} aria-hidden="true" /> : <PanelRight size={16} aria-hidden="true" />}
      </IconButton>
    </div>
  );
}
