import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['api/**/*.test.ts'],
    exclude: ['node_modules/**'],
    environment: 'node',
  },
});
