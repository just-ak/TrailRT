import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The bundled graph-building tools must carry the entitlement LuaJIT needs
 * (Phase 14 Requirement 17.4, ADR 0013). Without it, under the hardened
 * runtime, macOS kills the tile builder with "Code Signature Invalid / Invalid
 * Page" partway through reading roads: on 14 November 2026 that stopped every
 * build of more than one county from the development checkout, and the user
 * was told only that the system had stopped it.
 *
 * Checked on the files `npm run dev` and the tests run. The packaged app is
 * signed separately by build/sign-mac.cjs, which `npm run verify:package`
 * checks.
 */

const TOOLS = ['valhalla_build_tiles', 'valhalla_build_admins'].map((name) => resolve('resources/valhalla/bin', name));
const present = process.platform === 'darwin' && TOOLS.every((tool) => existsSync(tool));

describe.runIf(present)('the bundled graph-building tools', () => {
  for (const tool of TOOLS) {
    it(`${tool.split('/').at(-1)} may run LuaJIT's machine code`, () => {
      const entitlements = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', tool], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      expect(entitlements).toContain('com.apple.security.cs.allow-unsigned-executable-memory');
    });
  }
});
