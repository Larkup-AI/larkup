import { waitForWebUI } from "./utils/wait-for-server";
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
  console.log("  Waiting for web UI on :4567...");
  try {
    await waitForWebUI(120_000);
  } catch {
    throw new Error(
      "Web UI is not running on http://localhost:4567. " +
        "Start it with: pnpm dev (from repo root)"
    );
  }

  console.log("  ✓ Global setup complete\n");
}

export default globalSetup;
