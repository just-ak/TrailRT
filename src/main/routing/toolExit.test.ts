import { describe, expect, it } from 'vitest';
import { toolExitError } from './toolExit';

const messages = {
  cancelled: 'The region import was cancelled.',
  failed: 'Building the routing graph failed.',
  name: 'The tile builder',
};

describe('toolExitError', () => {
  it('is null for a clean exit', () => {
    expect(toolExitError({ code: 0, signal: null, aborted: false }, messages, '')).toBeNull();
  });

  it('reports a cancellation only when we aborted', () => {
    const error = toolExitError({ code: null, signal: 'SIGTERM', aborted: true }, messages, '');
    expect(error?.code).toBe('CANCELLED');
    expect(error?.message).toBe(messages.cancelled);
  });

  /*
   * The 0.1.0 regression: the kernel killed valhalla_build_tiles over its code
   * signature (LuaJIT under the hardened runtime), and the user was told the
   * import had been cancelled when they had pressed nothing.
   */
  it('reports a kill by the system as a failure, not a cancellation', () => {
    const error = toolExitError(
      { code: null, signal: 'SIGKILL', aborted: false },
      messages,
      '[INFO] Parsing ways...',
    );
    expect(error?.code).toBe('PROVIDER_ERROR');
    expect(error?.message).toContain('Building the routing graph failed.');
    expect(error?.message).toContain('SIGKILL');
    expect(error?.detail).toContain('code-signing');
    expect(error?.detail).toContain('Parsing ways');
  });

  it('names any other signal without guessing at a cause', () => {
    const error = toolExitError({ code: null, signal: 'SIGABRT', aborted: false }, messages, '');
    expect(error?.code).toBe('PROVIDER_ERROR');
    expect(error?.detail).toBe('Ended by SIGABRT.');
  });

  it('carries the log tail for a non-zero exit', () => {
    const error = toolExitError({ code: 1, signal: null, aborted: false }, messages, 'boom');
    expect(error?.code).toBe('PROVIDER_ERROR');
    expect(error?.message).toBe(messages.failed);
    expect(error?.detail).toBe('boom');
  });
});
