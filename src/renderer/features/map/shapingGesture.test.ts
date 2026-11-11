import { describe, expect, it } from 'vitest';
import {
  IDLE,
  LatestWins,
  PreviewCancelled,
  step,
  type GestureEvent,
  type GestureOutput,
  type GestureState,
} from './shapingGesture';

const LINE = { type: 'line', leg: 2 } as const;

function run(events: GestureEvent[]): GestureOutput[] {
  let state: GestureState = IDLE;
  const outputs: GestureOutput[] = [];
  for (const event of events) {
    const next = step(state, event);
    state = next.state;
    if (next.output !== null) outputs.push(next.output);
  }
  return outputs;
}

describe('click versus drag', () => {
  it('a press and release without movement is a click', () => {
    expect(run([{ type: 'down', target: LINE, x: 100, y: 100 }, { type: 'up' }])).toEqual([
      { type: 'click', target: LINE },
    ]);
  });

  it('a tremor under the threshold is still a click, never a tiny drag', () => {
    expect(
      run([
        { type: 'down', target: LINE, x: 100, y: 100 },
        { type: 'move', x: 102, y: 101 },
        { type: 'up' },
      ]),
    ).toEqual([{ type: 'click', target: LINE }]);
  });

  it('movement past the threshold starts a drag, which stays a drag if the pointer returns', () => {
    expect(
      run([
        { type: 'down', target: LINE, x: 100, y: 100 },
        { type: 'move', x: 110, y: 100 },
        { type: 'move', x: 100, y: 100 },
        { type: 'up' },
      ]).map((o) => o?.type),
    ).toEqual(['dragStart', 'dragMove', 'dragEnd']);
  });

  it('Escape cancels a drag and the release that follows does nothing', () => {
    expect(
      run([
        { type: 'down', target: LINE, x: 100, y: 100 },
        { type: 'move', x: 120, y: 100 },
        { type: 'escape' },
        { type: 'up' },
      ]).map((o) => o?.type),
    ).toEqual(['dragStart', 'cancel']);
  });

  it('movement with nothing pressed does nothing', () => {
    expect(run([{ type: 'move', x: 5, y: 5 }, { type: 'up' }])).toEqual([]);
  });
});

/** A controllable async operation: each call waits until released. */
function deferred() {
  const pending: { input: number; resolve: (v: string) => void; reject: (e: unknown) => void }[] =
    [];
  const runFn = (input: number) =>
    new Promise<string>((resolve, reject) => pending.push({ input, resolve, reject }));
  return { pending, runFn };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('LatestWins', () => {
  it('keeps one request in flight and draws only the latest position', async () => {
    const { pending, runFn } = deferred();
    const drawn: number[] = [];
    const preview = new LatestWins(runFn, (input) => drawn.push(input));

    preview.request(1);
    preview.request(2);
    preview.request(3);
    await tick();
    expect(pending.map((p) => p.input)).toEqual([1]);

    // The reply for 1 is stale: not drawn, and 3 (not 2) is sent next.
    pending[0]?.resolve('one');
    await tick();
    expect(drawn).toEqual([]);
    expect(pending.map((p) => p.input)).toEqual([1, 3]);

    pending[1]?.resolve('three');
    await tick();
    expect(drawn).toEqual([3]);
  });

  it('settle resolves with the result for exactly the final position', async () => {
    const { pending, runFn } = deferred();
    const preview = new LatestWins(runFn, () => undefined);

    preview.request(1);
    const final = preview.settle(2);
    await tick();
    pending[0]?.resolve('one');
    await tick();
    pending[1]?.resolve('two');
    await expect(final).resolves.toBe('two');
  });

  it('settle reuses a result already delivered for that position', async () => {
    const { pending, runFn } = deferred();
    const preview = new LatestWins(runFn, () => undefined);
    preview.request(7);
    await tick();
    pending[0]?.resolve('seven');
    await tick();
    await expect(preview.settle(7)).resolves.toBe('seven');
    expect(pending).toHaveLength(1);
  });

  it('cancel discards a reply still in flight and rejects anyone waiting', async () => {
    const { pending, runFn } = deferred();
    const drawn: number[] = [];
    const preview = new LatestWins(runFn, (input) => drawn.push(input));

    const waiting = preview.settle(1);
    await tick();
    preview.cancel();
    pending[0]?.resolve('late');
    await expect(waiting).rejects.toBeInstanceOf(PreviewCancelled);
    await tick();
    expect(drawn).toEqual([]);
  });

  it('a request after cancel is still served once the old reply lands', async () => {
    const { pending, runFn } = deferred();
    const drawn: number[] = [];
    const preview = new LatestWins(runFn, (input) => drawn.push(input));

    preview.request(1);
    await tick();
    preview.cancel();
    preview.request(2);
    pending[0]?.resolve('stale');
    await tick();
    pending[1]?.resolve('fresh');
    await tick();
    expect(drawn).toEqual([2]);
  });

  it('reports a failure for the latest position and rejects its waiter', async () => {
    const { pending, runFn } = deferred();
    const errors: unknown[] = [];
    const preview = new LatestWins(runFn, () => undefined, (e) => errors.push(e));
    const waiting = preview.settle(1);
    await tick();
    pending[0]?.reject(new Error('down'));
    await expect(waiting).rejects.toThrow('down');
    expect(errors).toHaveLength(1);
  });
});
