import { spawn } from 'node:child_process';
import { ServiceError } from '../services/errors';
import { toolExitError } from './toolExit';

/**
 * Merges several OpenStreetMap extracts into one with `trailrt-osm merge`.
 *
 * Valhalla's tile builder accepts several extracts, but it aborts on
 * overlapping ones — measured with Derbyshire, Cheshire and Staffordshire:
 * "Failed tile … vector", then exit 134 — and Geofabrik's regions always
 * overlap their neighbours, because the boundaries are buffered. The merge
 * takes sorted inputs and writes one sorted file holding each object once, at
 * its newest version: two counties downloaded on different days can carry
 * different versions of the same border road. About 1 s for Derbyshire and
 * Cheshire. ADRs 0018 and 0023.
 *
 * A one-shot child process, like the tile builder, and killable the same way.
 */
export function mergeExtracts(
  tool: string,
  inputs: readonly string[],
  output: string,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      tool,
      ['merge', output, ...inputs],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );

    let tail = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      tail = `${tail}${chunk.toString('utf8')}`.slice(-1500);
    });

    const onAbort = (): void => {
      child.kill('SIGTERM');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (cause) => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(
        new ServiceError(
          'PROVIDER_UNAVAILABLE',
          'The tool that combines regions could not be started. This build may be missing it.',
          cause.message,
        ),
      );
    });

    child.on('close', (code, signal) => {
      options.signal?.removeEventListener('abort', onAbort);
      const failure = toolExitError(
        { code, signal, aborted: options.signal?.aborted === true },
        {
          cancelled: 'The region download was cancelled.',
          failed: 'Combining the regions failed.',
          name: 'The region merge tool',
        },
        tail,
      );
      if (failure !== null) {
        reject(failure);
        return;
      }
      resolve();
    });
  });
}
