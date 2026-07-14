#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..");
const nextBin = path.join(packageDir, "node_modules", ".bin", "next");

const args = process.argv.slice(2);
const command = args[0];

if (command === "start") {
  const port = process.env.PORT || "4567";
  console.log(`Starting Larkup Studio on port ${port}...`);
  const result = spawnSync(nextBin, ["start", "-p", port], {
    cwd: packageDir,
    stdio: "inherit",
  });
  if (result.error) {
    console.error("Failed to start server:", result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
} else {
  console.error("Usage: larkup start");
  process.exit(1);
}
