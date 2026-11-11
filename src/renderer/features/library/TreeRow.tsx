import type { ReactNode } from "react";
import type { TreeNode } from "@shared/domain/types";

/** Which modifier keys were held, so the panel can decide what a click means. */
export interface ClickModifiers {
  /** ⌘ on macOS: toggle this row's membership. */
  metaKey: boolean;
  /** Extend the selection from the anchor to here. */
  shiftKey: boolean;
}

interface Props {
  node: TreeNode;
  depth: number;
  /** The anchor: what the properties panel is describing. */
  selected: boolean;
  /** A member of a multi-selection, which may or may not be the anchor. */
  inSelection: boolean;
  expanded: boolean;
  hasChildren: boolean;
  renaming: boolean;
  dropTarget: boolean;
  /** The single tab stop in the tree. See the roving tabIndex in LibraryPanel. */
  focusable: boolean;
  onToggle: () => void;
  onSelect: (modifiers: ClickModifiers) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onFocusRow?: () => void;
  onDragStart?: (event: React.DragEvent) => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (event: React.DragEvent) => void;
}

const INDENT = 14;

/**
 * Focuses the rename field and selects the whole name, so typing replaces it
 * as Finder does. Used as a callback ref, which fires on mount — the rename
 * input is keyed, so entering rename mode mounts a fresh one rather than
 * resetting state from an effect.
 */
function focusAndSelect(input: HTMLInputElement | null): void {
  input?.focus();
  input?.select();
}

function Chevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M3 1.5 L7 5 L3 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function Icon({ node }: { node: TreeNode }): ReactNode {
  if (node.kind === "folder") return <span aria-hidden="true">📁</span>;
  if (node.kind === "trip") return <span aria-hidden="true">🗺️</span>;
  if (node.kind === "root") return <span aria-hidden="true">📚</span>;
  if (node.kind === "route") return <span aria-hidden="true">〰️</span>;
  // A recorded track, distinguishable from a drawn route at a glance.
  if (node.kind === "track") return <span aria-hidden="true">📈</span>;
  if (node.kind === "waypoint") return <span aria-hidden="true">📍</span>;
  if (node.kind === "group") return <span aria-hidden="true">{node.glyph ?? "▫️"}</span>;
  return <span aria-hidden="true">🔖</span>;
}

export function TreeRow({
  node,
  depth,
  selected,
  inSelection,
  expanded,
  hasChildren,
  renaming,
  dropTarget,
  focusable,
  onToggle,
  onSelect,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  onFocusRow,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: Props): ReactNode {
  const unavailable = node.kind === "view" && node.available === false;
  const archived = node.status === "archived";

  /*
   * Three visual states, not two.
   *
   * The anchor is filled, a non-anchor member of a multi-selection is tinted,
   * and everything else is plain. Without the distinction a batch of twelve
   * would look identical to a single selection of twelve, and the properties
   * panel describing only one of them would appear to be a bug.
   */
  const background = selected
    ? "bg-[var(--color-accent)] text-white"
    : inSelection
      ? "bg-[var(--color-accent)]/30"
      : dropTarget
        ? "bg-[var(--color-accent)]/20"
        : "hover:bg-[var(--color-surface-sunken)]";

  return (
    <div
      role="treeitem"
      // The row's position in the tree. The keyboard handler moves DOM focus
      // by querying this, because focus has to follow the roving tabIndex and
      // only the panel knows the visible row order.
      data-path={node.id}
      // An explicit label keeps the accessible name exactly the object's name.
      // Without it the name is composed from the row's contents, which pulls in
      // the chevron button's label and the status badges.
      aria-label={node.name}
      // Reports membership of the selection rather than just "is the anchor",
      // so a screen reader announces all twelve members of a batch.
      aria-selected={inSelection || selected}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-level={depth + 1}
      // Roving tabIndex: exactly one row in the tree is tabbable, and the
      // arrow keys move which one. A tree where every row is a tab stop is
      // unusable with a keyboard, and one where none is cannot be reached.
      tabIndex={focusable ? 0 : -1}
      onFocus={onFocusRow}
      draggable={onDragStart !== undefined && !renaming}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      onClick={(event) => {
        event.stopPropagation();
        if (unavailable) return;
        // The modifiers are the whole point: the row cannot decide what a
        // click means, because only the panel knows the anchor and the
        // visible row order a range is measured over.
        onSelect({ metaKey: event.metaKey, shiftKey: event.shiftKey });
      }}
      onDoubleClick={() => {
        if (hasChildren) onToggle();
      }}
      style={{ paddingLeft: depth * INDENT + 6 }}
      className={`group flex h-[26px] cursor-default items-center gap-1.5 pr-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] focus-visible:ring-inset ${background} ${unavailable ? "opacity-55" : ""}`}
    >
      <button
        type="button"
        tabIndex={-1}
        // Hidden from assistive technology on purpose: expansion is already
        // conveyed by the treeitem's aria-expanded, so a second control for it
        // is redundant and would pollute the row's accessible name.
        aria-hidden="true"
        onClick={(event) => {
          event.stopPropagation();
          if (hasChildren) onToggle();
        }}
        className={`flex h-4 w-4 shrink-0 items-center justify-center ${
          hasChildren ? "opacity-70 hover:opacity-100" : "invisible"
        }`}
      >
        <Chevron open={expanded} />
      </button>

      <span className="shrink-0 text-[12px]">
        <Icon node={node} />
      </span>

      {renaming ? (
        <input
          key={`rename-${node.id}-${node.name}`}
          ref={focusAndSelect}
          defaultValue={node.name}
          onBlur={(event) => onRenameCommit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onRenameCommit(event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onRenameCancel();
            }
          }}
          onClick={(event) => event.stopPropagation()}
          className="min-w-0 flex-1 rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1 py-0 text-[13px] text-[var(--color-text-primary)] outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">
          {node.name}
          {node.detail !== undefined && (
            <span
              className={`ml-1.5 text-[11px] ${selected ? "text-white/70" : "text-[var(--color-text-muted)]"}`}
            >
              {node.detail}
            </span>
          )}
          {archived && (
            <span
              className={`ml-1.5 text-[11px] ${selected ? "text-white/70" : "text-[var(--color-text-muted)]"}`}
            >
              archived
            </span>
          )}
          {unavailable && (
            <span
              className={`ml-1.5 text-[11px] ${selected ? "text-white/70" : "text-[var(--color-text-muted)]"}`}
            >
              later phase
            </span>
          )}
        </span>
      )}
    </div>
  );
}
