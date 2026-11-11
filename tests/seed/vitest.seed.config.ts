import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Builds the place and postcode databases the Phase 10 end-to-end tests seed
 * into the app's data folder, from the committed real-data fixtures, with the
 * app's own ingest code. Run by `tests/e2e/roadtrip.spec.ts`; not part of the
 * unit suite.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@shared': resolve('src/shared'),
      '@fixtures': resolve('test-data'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/seed/*.seed.ts'],
  },
});
