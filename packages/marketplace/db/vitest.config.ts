import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/db/**/*.test.ts'],
    exclude: ['node_modules/**'],
    environment: 'node',
    // Database tests share one connection pool.
    fileParallelism: false,
  },
});
