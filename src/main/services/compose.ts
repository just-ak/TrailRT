import type { Command } from './commands';
import type { Mutation } from './folderService';

/**
 * Several mutations, already applied in order, as one undoable step.
 *
 * The inverse is a `batch` of their inverses in reverse order, so one undo
 * unwinds them last-first, and the redo of that is the original order again
 * (ADR 0014).
 */
export function batch<T>(result: T, ...mutations: Mutation<unknown>[]): Mutation<T> {
  const inverses: Command[] = mutations
    .map((m) => m.inverse)
    .filter((inverse) => inverse.kind !== 'none')
    .toReversed();
  return { result, inverse: { kind: 'batch', payload: { commands: inverses } } };
}
