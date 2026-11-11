import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { clampDrawerHeight } from './drawerHeight';

/**
 * The panel below the map, resizable by its top edge. Phase 10 Requirement
 * 16.1. The same pointer and keyboard behaviour as `SplitPane`, turned on its
 * side: drag the edge, or focus it and use the arrow keys.
 */

interface Props {
  height: number;
  /** The column the map and the panel share, for the map's minimum. */
  columnHeight: () => number;
  onResize: (height: number) => void;
  children: ReactNode;
}

export function DrawerPane({ height, columnHeight, onResize, children }: Props): ReactNode {
  const dragging = useRef(false);
  const shown = clampDrawerHeight(height, columnHeight());

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      dragging.current = true;
      const startY = event.clientY;
      const startHeight = shown;
      const onMove = (move: PointerEvent): void => {
        if (!dragging.current) return;
        onResize(clampDrawerHeight(startHeight + (startY - move.clientY), columnHeight()));
      };
      const onUp = (): void => {
        dragging.current = false;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'row-resize';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [shown, onResize, columnHeight],
  );

  useEffect(() => {
    const cancel = (): void => {
      dragging.current = false;
      document.body.style.cursor = '';
    };
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, []);

  return (
    <div className="relative flex shrink-0 flex-col border-t border-[var(--color-border-subtle)]" style={{ height: shown }}>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the panel below the map"
        aria-valuenow={shown}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 40 : 8;
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            onResize(clampDrawerHeight(shown + (event.key === 'ArrowUp' ? step : -step), columnHeight()));
          }
        }}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize hover:bg-[var(--color-accent)]/40 focus-visible:bg-[var(--color-accent)]/60 focus-visible:outline-none"
      />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
