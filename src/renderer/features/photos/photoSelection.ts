/**
 * Selection in the photo list (design §8.3): a plain click selects one photo,
 * ⌘ adds or removes one, Shift selects the range from the anchor. The same
 * rules as the library tree, kept pure so they are tested without a window.
 */

export interface PhotoSelection {
  ids: ReadonlySet<string>;
  /** The last photo clicked: the one the preview shows. */
  anchor: string | null;
}

export const NO_PHOTO_SELECTION: PhotoSelection = { ids: new Set(), anchor: null };

export function clickPhoto(
  current: PhotoSelection,
  id: string,
  modifiers: { metaKey: boolean; shiftKey: boolean },
  order: readonly string[],
): PhotoSelection {
  if (modifiers.shiftKey && current.anchor !== null) {
    const from = order.indexOf(current.anchor);
    const to = order.indexOf(id);
    if (from >= 0 && to >= 0) {
      const [start, end] = from <= to ? [from, to] : [to, from];
      // The anchor stays where the range started, so a second Shift-click
      // extends from the same place rather than ratcheting along.
      return { ids: new Set(order.slice(start, end + 1)), anchor: current.anchor };
    }
  }
  if (modifiers.metaKey) {
    const ids = new Set(current.ids);
    if (ids.has(id)) {
      ids.delete(id);
      const anchor = current.anchor === id ? ([...ids].at(-1) ?? null) : current.anchor;
      return { ids, anchor };
    }
    ids.add(id);
    return { ids, anchor: id };
  }
  return { ids: new Set([id]), anchor: id };
}

/** Drops photos no longer in the list, after a rescan. */
export function pruneSelection(current: PhotoSelection, present: ReadonlySet<string>): PhotoSelection {
  const ids = new Set([...current.ids].filter((id) => present.has(id)));
  if (ids.size === current.ids.size) return current;
  const anchor = current.anchor !== null && present.has(current.anchor) ? current.anchor : ([...ids].at(-1) ?? null);
  return { ids, anchor };
}
