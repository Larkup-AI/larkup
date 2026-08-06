import { defineConfig } from '@playwright/test';

/**
 * Video Knowledge regression tests do not need a Web server or provider keys.
 * Keep this independently runnable so media primitives, deterministic
 * evidence retrieval policy, and chat-tool wiring are caught before API/UI
 * E2E setup is available.
 */
export default defineConfig({
  testDir: './tests/api',
  testMatch:
    /(marketplace-loader|media-(progress|vision-provider)|video-(audio-tool|investigation-hierarchy|knowledge-(approval|conflict|evaluation|sandbox)|chat-routing))\.spec\.ts/,
  timeout: 120_000,
  reporter: 'list',
  workers: 1,
});
