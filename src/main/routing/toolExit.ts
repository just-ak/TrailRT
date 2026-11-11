import { ServiceError } from '../services/errors';

/**
 * How a bundled command-line tool ended, turned into the error the user sees.
 *
 * Shared by every child process the app runs — `valhalla_build_tiles`,
 * `osmium merge` and the `osmium` place extract — because they all have to make
 * the same distinction, and getting it wrong once already hid a broken release.
 *
 * A process that ends on a signal was **cancelled only if we asked it to be**.
 * The 0.1.0 DMG reported every signal as a cancellation, so when the kernel
 * killed the tile builder over its code signature, the user was told "The region
 * import was cancelled" — after pressing nothing — and the build appeared to
 * stop silently after the download.
 */
export interface ToolExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Whether our own AbortSignal fired. */
  aborted: boolean;
}

export interface ToolMessages {
  /** e.g. "The region import was cancelled." */
  cancelled: string;
  /** e.g. "Building the routing graph failed." */
  failed: string;
  /** What the tool is, in plain words, e.g. "The tile builder". */
  name: string;
}

/** Null on success; otherwise the error to reject with. */
export function toolExitError(
  exit: ToolExit,
  messages: ToolMessages,
  tail: string,
): ServiceError | null {
  if (exit.aborted) return new ServiceError('CANCELLED', messages.cancelled);

  if (exit.signal !== null) {
    return new ServiceError(
      'PROVIDER_ERROR',
      `${messages.failed} ${messages.name} was stopped by the system (${exit.signal}) before it finished.`,
      [
        exit.signal === 'SIGKILL'
          ? 'SIGKILL from the system usually means macOS refused to run the code (a code-signing problem) or memory ran out.'
          : `Ended by ${exit.signal}.`,
        tail,
      ]
        .filter((part) => part.length > 0)
        .join('\n'),
    );
  }

  if (exit.code !== 0) {
    return new ServiceError('PROVIDER_ERROR', messages.failed, tail);
  }

  return null;
}
