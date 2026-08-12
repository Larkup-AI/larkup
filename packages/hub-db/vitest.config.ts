import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**'],
    environment: 'node',
    // Repo tests share one real Postgres connection pool; parallel test
    // files would race each other's transactions against the same tables.
    fileParallelism: false,
  },
});
