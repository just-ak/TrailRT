import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * TrailRT never writes into a linked folder (Requirement 8.1). The first of
 * design §7.3's three layers: the module that reads linked folders cannot
 * write at all. Every source file in `src/main/linkedFolders/` is read, with
 * comments removed, and any call to a filesystem write API, a write flag, or a
 * process other than `/usr/bin/stat` fails the test.
 *
 * Thumbnails are written by `main/photoCache/`, below TrailRT's own data
 * folder, and Phase 12's GPX writer will live outside this directory, so this
 * holds for everything that reads a linked folder.
 */

const MODULE_DIR = join(process.cwd(), 'src', 'main', 'linkedFolders');

/** Calls that write, move, delete, or change metadata. `Sync` forms included. */
const WRITE_CALLS = [
  'writeFile',
  'appendFile',
  'createWriteStream',
  'rename',
  'rm',
  'rmdir',
  'unlink',
  'utimes',
  'lutimes',
  'futimes',
  'chmod',
  'lchmod',
  'fchmod',
  'chown',
  'lchown',
  'fchown',
  'copyFile',
  'cp',
  'mkdir',
  'mkdtemp',
  'truncate',
  'ftruncate',
  'symlink',
  'link',
  'write',
  'writev',
  'exec',
  'execSync',
  'spawn',
  'spawnSync',
  'fork',
];

const WRITE_CALL = new RegExp(`\\b(${WRITE_CALLS.join('|')})(Sync)?\\s*\\(`, 'g');
const WRITE_FLAG = /\bO_(WRONLY|RDWR|CREAT|APPEND|TRUNC)\b|(['"`])(w|wx|w\+|wx\+|a|ax|a\+|ax\+|r\+|rs\+)\2/g;
const DYNAMIC_IMPORT = /\bimport\s*\(/g;
const EXEC_FILE = /\bexecFile(Sync)?\s*\(\s*([^,)]*)/g;

/**
 * Removes comments, keeping strings, so prose such as "never writes" or
 * "rename the folder" in a comment is not mistaken for a call.
 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';
    if (quote !== null) {
      out += ch;
      if (ch === '\\') {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    out += ch;
    i += 1;
  }
  return out;
}

export interface Violation {
  file: string;
  line: number;
  text: string;
}

/** Every write the sources in `dir` could make. Test files are left out: they build fixtures. */
export function findWrites(dir: string): Violation[] {
  const violations: Violation[] = [];
  const files = readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  for (const file of files) {
    const code = stripComments(readFileSync(join(dir, file), 'utf8'));
    const lineOf = (index: number): number => code.slice(0, index).split('\n').length;
    for (const pattern of [WRITE_CALL, WRITE_FLAG, DYNAMIC_IMPORT]) {
      for (const match of code.matchAll(pattern)) {
        violations.push({ file, line: lineOf(match.index), text: match[0] });
      }
    }
    // `execFile` is allowed for one program: `stat`, which only reads flags.
    for (const match of code.matchAll(EXEC_FILE)) {
      if (match[2]?.trim() !== "'/usr/bin/stat'") violations.push({ file, line: lineOf(match.index), text: match[0] });
    }
  }
  return violations;
}

let scratch: string | null = null;

afterEach(() => {
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe('src/main/linkedFolders is read-only', () => {
  it('has source files to check', () => {
    const names = readdirSync(MODULE_DIR);
    for (const expected of ['scanner.ts', 'fileReader.ts', 'resolve.ts', 'folderScanner.ts', 'dataless.ts']) {
      expect(names).toContain(expected);
    }
  });

  it('calls no filesystem write API, uses no write flag, and runs nothing but stat', () => {
    expect(findWrites(MODULE_DIR)).toEqual([]);
  });

  it('fails when a write is added: a copy of the module with one extra file', () => {
    scratch = mkdtempSync(join(tmpdir(), 'trailrt-p11-readonly-'));
    for (const name of readdirSync(MODULE_DIR)) {
      if (name.endsWith('.ts')) copyFileSync(join(MODULE_DIR, name), join(scratch, name));
    }
    expect(findWrites(scratch)).toEqual([]);

    const offenders: Record<string, string> = {
      'promises.ts': "import { writeFile } from 'node:fs/promises';\nexport const save = (p: string) => writeFile(p, 'x');\n",
      'sync.ts': "import * as fs from 'node:fs';\nexport const go = (p: string) => fs.renameSync(p, p + '.old');\n",
      'flags.ts': "import { open } from 'node:fs/promises';\nexport const f = (p: string) => open(p, 'a');\n",
      'constant.ts': "import { constants, openSync } from 'node:fs';\nexport const f = (p: string) => openSync(p, constants.O_RDWR);\n",
      'shell.ts': "import { execFile } from 'node:child_process';\nexport const f = (p: string) => execFile('/bin/rm', [p]);\n",
      'dynamic.ts': "export const f = async () => (await import('node:fs')).rmSync('/x');\n",
    };
    for (const [name, source] of Object.entries(offenders)) {
      writeFileSync(join(scratch, name), source);
      const found = findWrites(scratch).filter((v) => v.file === name);
      expect(found.length, `${name} was not caught`).toBeGreaterThan(0);
      rmSync(join(scratch, name));
    }
  });

  it('is not fooled by prose in comments', () => {
    expect(stripComments("// rename(a)\nconst a = 1; /* rm(x) */ const b = 'rm(y)';")).toBe("\nconst a = 1;  const b = 'rm(y)';");
  });
});
