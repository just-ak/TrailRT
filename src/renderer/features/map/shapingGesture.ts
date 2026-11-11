/**
 * The pure parts of drag-to-shape. Phase 6, design §4.
 *
 * Two pieces of logic decide whether shaping feels right, and both are easy to
 * get subtly wrong inside an event handler, so they live here where they can
 * be tested without a map:
 *
 * - telling a click on the line from a drag of it (Requirement 4.6), and
 * - keeping a live preview to one request in flight with the latest pointer
 *   position winning (Requirement 4.2).
 */

/** Movement, in screen pixels, before a press on the line becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;

export type GestureTarget =
  | { type: 'line'; leg: number }
  | { type: 'handle'; index: number };

export type GestureState =
  | { kind: 'idle' }
  | { kind: 'pressed'; target: GestureTarget; x: number; y: number }
  | { kind: 'dragging'; target: GestureTarget };

export type GestureEvent =
  | { type: 'down'; target: GestureTarget; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'up' }
  | { type: 'escape' };

export type GestureOutput =
  | { type: 'click'; target: GestureTarget }
  | { type: 'dragStart'; target: GestureTarget }
  | { type: 'dragMove'; target: GestureTarget }
  | { type: 'dragEnd'; target: GestureTarget }
  | { type: 'cancel'; target: GestureTarget }
  | null;

export const IDLE: GestureState = { kind: 'idle' };

/**
 * One step of the press–move–release machine.
 *
 * A press that never moves past the threshold is a click; one that does is a
 * drag, and stays a drag even if the pointer comes back — returning to where
 * it started is a deliberate gesture, not an accident. Escape abandons either.
 */
export function step(
  state: GestureState,
  event: GestureEvent,
): { state: GestureState; output: GestureOutput } {
  switch (event.type) {
    case 'down':
      return {
        state: { kind: 'pressed', target: event.target, x: event.x, y: event.y },
        output: null,
      };

    case 'move':
      if (state.kind === 'pressed') {
        if (Math.hypot(event.x - state.x, event.y - state.y) < DRAG_THRESHOLD_PX) {
          return { state, output: null };
        }
        return {
          state: { kind: 'dragging', target: state.target },
          output: { type: 'dragStart', target: state.target },
        };
      }
      if (state.kind === 'dragging') {
        return { state, output: { type: 'dragMove', target: state.target } };
      }
      return { state, output: null };

    case 'up':
      if (state.kind === 'pressed') return { state: IDLE, output: { type: 'click', target: state.target } };
      if (state.kind === 'dragging') return { state: IDLE, output: { type: 'dragEnd', target: state.target } };
      return { state, output: null };

    case 'escape':
      if (state.kind === 'idle') return { state, output: null };
      return { state: IDLE, output: { type: 'cancel', target: state.target } };
  }
}

/** Raised to anyone waiting on a preview that was cancelled. */
export class PreviewCancelled extends Error {
  override name = 'PreviewCancelled';
}

interface Waiter<I, O> {
  input: I;
  resolve: (output: O) => void;
  reject: (cause: unknown) => void;
}

/**
 * Runs an async operation for a stream of inputs, keeping at most one in
 * flight and delivering only the result for the most recent input.
 *
 * A drag produces a pointer position every few milliseconds. Sending a route
 * request for each would queue hundreds and draw them out of order; dropping
 * all but one per frame still draws stale replies. Here a reply is drawn only
 * if its input is still the latest, and otherwise the latest is sent next — so
 * the preview is never behind by more than one request and never shows a
 * position the pointer has left.
 */
export class LatestWins<I, O> {
  private latest: I | null = null;
  private inFlight = false;
  private generation = 0;
  private last: { input: I; output: O } | null = null;
  private waiters: Waiter<I, O>[] = [];

  constructor(
    private readonly run: (input: I) => Promise<O>,
    private readonly onResult: (input: I, output: O) => void,
    private readonly onError: (cause: unknown) => void = () => undefined,
  ) {}

  /** Asks for `input`; supersedes anything not yet delivered. */
  request(input: I): void {
    this.latest = input;
    void this.pump();
  }

  /** Resolves with the result for exactly `input`, requesting it if needed. */
  settle(input: I): Promise<O> {
    if (this.latest === null && this.last !== null && this.last.input === input) {
      return Promise.resolve(this.last.output);
    }
    return new Promise<O>((resolve, reject) => {
      this.waiters.push({ input, resolve, reject });
      this.request(input);
    });
  }

  /** Drops everything pending; replies still in flight are discarded. */
  cancel(): void {
    this.generation += 1;
    this.latest = null;
    this.last = null;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.reject(new PreviewCancelled('The preview was cancelled.'));
  }

  private async pump(): Promise<void> {
    if (this.inFlight) return;
    while (this.latest !== null) {
      const input = this.latest;
      const generation = this.generation;
      this.inFlight = true;

      let output: O | undefined;
      let failure: unknown = null;
      let failed = false;
      try {
        // eslint-disable-next-line no-await-in-loop
        output = await this.run(input);
      } catch (cause) {
        failed = true;
        failure = cause;
      }
      this.inFlight = false;

      // Cancelled while in flight: the reply belongs to a gesture that no
      // longer exists. Anything requested since is picked up by the loop.
      if (generation !== this.generation) continue;
      // Superseded: send the newer input instead of drawing this one.
      if (this.latest !== input) continue;

      this.latest = null;
      const waiting = this.waiters.filter((w) => w.input === input);
      this.waiters = this.waiters.filter((w) => w.input !== input);
      if (failed) {
        this.onError(failure);
        for (const w of waiting) w.reject(failure);
      } else {
        const result = output as O;
        this.last = { input, output: result };
        this.onResult(input, result);
        for (const w of waiting) w.resolve(result);
      }
    }
  }
}
