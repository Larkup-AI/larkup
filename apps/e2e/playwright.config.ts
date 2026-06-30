import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEB_UI_URL = "http://localhost:4567";
const RAG_SERVER_URL = "http://localhost:8080";
const DOCS_URL = "http://localhost:3000"; // mintlify dev default

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // sequential pipeline — tests build on each other
  forbidOnly: true,
  retries: 1,
  workers: 1, // single worker for sequential pipeline
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 120_000, // 2 min per test (indexing/server ops can be slow)
  expect: {
    timeout: 30_000,
  },

  use: {
    baseURL: WEB_UI_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  globalSetup: path.resolve(__dirname, "global-setup.ts"),
  globalTeardown: path.resolve(__dirname, "global-teardown.ts"),
});

export { WEB_UI_URL, RAG_SERVER_URL, DOCS_URL };
