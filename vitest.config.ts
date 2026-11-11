import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@preload': resolve('src/preload'),
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer'),
      // Test fixtures, including the shared test geography. Deliberately
      // outside `src/` so nothing the application ships can import it.
      '@fixtures': resolve('test-data'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**', 'src/shared/**'],
      reporter: ['text', 'html'],
    },
  },
});
