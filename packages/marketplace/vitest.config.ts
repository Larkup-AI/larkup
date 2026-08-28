import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // src/db/** requires a real Postgres connection and already has its own
    // dedicated runner (`pnpm db:test`, db/vitest.config.ts) -- keep it out
    // of the default `pnpm test` so this doesn't fail without a database.
    exclude: ['node_modules/**', 'db/**', 'src/db/**'],
    environment: 'node',
    fileParallelism: false,
  },
});
