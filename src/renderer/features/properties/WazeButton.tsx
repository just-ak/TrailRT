import { useState, type ReactNode } from "react";
import type { LatLon } from "@shared/geo/distance";
import { WAZE_LIMITATION, wazeTargetsFor } from "@shared/integrations/waze";
import { ContextMenu } from "../../components/ContextMenu";
import { ICON_BUTTON_CLASS } from "../../components/IconButton";
import * as actions from "../../lib/actions";

/**
 * Hands one point to Waze — Requirement 7, made less prominent after owner
 * feedback (Phase 7 Requirement 6).
 *
 * A small icon rather than a full-width button. For a route or track it opens a
 * menu offering the **start** or the **end**. Each item sends that single
 * point, because Waze's deep link takes one destination and has no parameter
 * for intermediate stops. There is still no "send the whole route" action, and
 * the tooltip says why.
 *
 * Disabled with a reason when there is no geometry, rather than hidden: a
 * control that comes and goes is harder to understand than one that explains
 * itself.
 */

/** A generic navigation arrow. Not Waze's logo, which is a trademark. */
function NavigateIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M3 11 21 3l-8 18-2-8-8-2Z" />
    </svg>
  );
}

export function WazeButton({
  selection,
}: {
  selection:
    | { kind: "waypoint"; name: string; point: LatLon }
    | { kind: "route" | "track"; name: string; points: readonly LatLon[] };
}): ReactNode {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const targets = wazeTargetsFor(selection);

  if (targets.length === 0) {
    return (
      <button
        type="button"
        disabled
        aria-label="Navigate in Waze"
        title="There is no point here to send."
        className={ICON_BUTTON_CLASS}
      >
        <NavigateIcon />
      </button>
    );
  }

  const isSinglePoint = selection.kind === "waypoint";

  return (
    <>
      <button
        type="button"
        aria-label="Navigate in Waze"
        aria-haspopup={isSinglePoint ? undefined : "menu"}
        aria-expanded={isSinglePoint ? undefined : menuAt !== null}
        title={
          isSinglePoint
            ? `Navigate to ${selection.name} in Waze`
            : `Navigate to the start or end of ${selection.name} in Waze. ${WAZE_LIMITATION}`
        }
        onClick={(event) => {
          if (isSinglePoint) {
            const only = targets[0];
            if (only !== undefined) void actions.openInWaze(only.point);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setMenuAt({ x: rect.left, y: rect.bottom + 4 });
        }}
        className={ICON_BUTTON_CLASS}
      >
        <NavigateIcon />
      </button>

      {menuAt !== null && (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          onClose={() => setMenuAt(null)}
          items={targets.map((target) => ({
            label: `Navigate to ${target.label.toLowerCase()} in Waze`,
            onSelect: () => void actions.openInWaze(target.point),
          }))}
        />
      )}
    </>
  );
}
