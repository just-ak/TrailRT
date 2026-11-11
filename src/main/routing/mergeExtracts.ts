import { spawn } from 'node:child_process';
import { ServiceError } from '../services/errors';

/**
 * Merges several OpenStreetMap extracts into one with `osmium merge`.
 *
 * Valhalla's tile builder accepts several extracts, but it aborts on
 * overlapping ones — measured with Derbyshire, Cheshire and Staffordshire:
 * "Failed tile … vector", then exit 134 — and Geofabrik's regions always
 * overlap their neighbours, because the boundaries are buffered. `osmium merge`
 * takes sorted inputs and writes one sorted, deduplicated file, which builds
 * cleanly. For those three counties it takes about 1.5 s. ADR 0018.
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
      ['merge', ...inputs, '-o', output, '--overwrite', '--no-progress'],
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
      if (signal !== null) {
        reject(new ServiceError('CANCELLED', 'The region download was cancelled.'));
        return;
      }
      if (code !== 0) {
        reject(
          new ServiceError('PROVIDER_ERROR', 'Combining the regions failed.', tail),
        );
        return;
      }
      resolve();
    });
  });
}
