import { waitForServer } from "./utils/wait-for-server";
import "./utils/env-loader"; // side-effect: loads .env.e2e

async function globalSetup() {
  console.log("\n🔧 E2E Global Setup");
  console.log("  Loading .env.e2e...");

  // Verify critical env vars exist
  const requiredVars = ["AI_GATEWAY_APIKEY"];
  const missing = requiredVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.warn(
      `  ⚠ Missing env vars (some tests may be skipped): ${missing.join(", ")}`
    );
  }

  // Wait for the web dev server to be up
  const webUrl = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:4567";
  console.log(`  Waiting for web UI at ${webUrl}...`);
  try {
    await waitForServer(webUrl, { timeout: 120_000, label: "Web UI" });
  } catch {
    throw new Error(
      `Web UI is not running at ${webUrl}. ` +
        "Start it with: pnpm dev (from repo root)"
    );
  }

  console.log("  ✓ Global setup complete\n");
}

export default globalSetup;
