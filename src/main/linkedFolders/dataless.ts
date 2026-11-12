import { execFile } from 'node:child_process';

/**
 * Which files are iCloud Drive "dataless": listed in the folder but not
 * downloaded to this Mac. Phase 11, design §5.4.
 *
 * Opening such a file, even to read its first bytes, makes macOS download all
 * of it, so the scanner asks before it opens. A dataless file carries the
 * `SF_DATALESS` flag and occupies no blocks. Node's `Stats` gives the blocks
 * but not the flags, so the scanner picks out candidates by `blocks === 0`,
 * which costs nothing, and this confirms them with `/usr/bin/stat`, a batch
 * at a time.
 *
 * Run with `execFile` and an argument array, never a shell, so a file name can
 * never be interpreted as a command.
 */

export const SF_DATALESS = 0x4000_0000;

/** Paths per `stat` call. Keeps the argument list well inside the system limit. */
export const BATCH = 200;

export type DatalessCheck = (paths: readonly string[]) => Promise<Set<string>>;

function statFlags(paths: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    // `stat` exits non-zero if any path has gone, but still prints the rest,
    // so its output is used either way. Each line carries its path, so lines
    // are matched by path rather than by position.
    execFile('/usr/bin/stat', ['-f', '%f:%N', '--', ...paths], { maxBuffer: 16 * 1024 * 1024 }, (_error, stdout) => {
      resolve(typeof stdout === 'string' ? stdout : '');
    });
  });
}

/**
 * The subset of `paths` that are dataless. A candidate whose flags could not
 * be read is treated as dataless: wrongly listing a sparse file as "not
 * downloaded" is a small error, and wrongly opening a dataless file downloads
 * it, which Requirement 3.6 forbids.
 */
export const checkDataless: DatalessCheck = async (paths) => {
  const dataless = new Set<string>();
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH);
    const flags = new Map<string, number>();
    for (const line of (await statFlags(batch)).split('\n')) {
      const colon = line.indexOf(':');
      if (colon <= 0) continue;
      const value = Number(line.slice(0, colon));
      if (Number.isInteger(value)) flags.set(line.slice(colon + 1), value);
    }
    for (const path of batch) {
      const value = flags.get(path);
      if (value === undefined || (value & SF_DATALESS) !== 0) dataless.add(path);
    }
  }
  return dataless;
};
