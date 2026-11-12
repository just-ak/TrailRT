import type { ReactNode } from "react";

/**
 * The map's bottom-left corner: the scale bar and readout, the panel toggles,
 * and the photo preview, stacked upwards in that order (Phase 11 design
 * §10.1, Requirements 6.1 and 6.2).
 *
 * One column instead of hand-picked `bottom-*` offsets, so the preview always
 * sits above the other two and none overlaps another. Its height stops short
 * of the top band, so it never reaches the search box (top left) or the zoom
 * and layer controls (top right), and its width stops short of the right
 * edge. Inside the map's container, it follows the map as the panels around
 * it are resized or hidden. The column itself lets clicks through to the map;
 * only its controls take them.
 */
export function MapCornerStack({ children }: { children: ReactNode }): ReactNode {
  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-col-reverse items-start gap-1.5"
      style={{ maxHeight: "calc(100% - 84px)", maxWidth: "calc(100% - 80px)" }}
      data-testid="map-corner-stack"
    >
      {children}
    </div>
  );
}
