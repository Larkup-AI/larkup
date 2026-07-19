import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEB_UI_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4567';
const RAG_SERVER_URL = process.env.RAG_SERVER_URL || 'http://localhost:8080';
const DOCS_URL = process.env.DOCS_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true, // Run test files in parallel
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['html', { open: 'never' }], ['list']],
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },

  use: {
    baseURL: WEB_UI_URL,
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  },

  projects: [
    {
      name: 'web-ui',
      testDir: './tests/web-ui',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'api',
      testDir: './tests/api',
    },
    {
      name: 'sdk',
      testDir: './tests/sdk',
      dependencies: ['api'],
    },
    {
      name: 'cli',
      testDir: './tests/cli',
      dependencies: ['api'],
    },
    {
      name: 'installation',
      testDir: './tests/installation',
      dependencies: ['web-ui'],
    },
  ],

  globalSetup: path.resolve(__dirname, 'global-setup.ts'),
  globalTeardown: path.resolve(__dirname, 'global-teardown.ts'),
});

export { WEB_UI_URL, RAG_SERVER_URL, DOCS_URL };
