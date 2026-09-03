import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirrors the `@/*` path alias in tsconfig, so a module under test can use
  // the same imports as the app rather than relative paths for testability.
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    environment: 'node',
  },
});
