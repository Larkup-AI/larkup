import { spawn } from "node:child_process";
import pkg from "../../package.json" with { type: "json" };
import { getLatestVersion, isVersionNewer } from "../updater";
import { log } from "../ui/logger";

export async function updateCommand(options: { check?: boolean }) {
  const latest = await getLatestVersion();
  if (!latest) {
    log.warn("Could not check for an update. Try again when you are online.");
    return;
  }

  if (!isVersionNewer(latest, pkg.version)) {
    log.success(`Larkup CLI ${pkg.version} is up to date.`);
    return;
  }

  log.info(`Update available: ${pkg.version} → ${latest}`);
  if (options.check) return;

  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["install", "-g", `@larkup/cli@${latest}`], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npm exited with code ${code}`))));
  });
  log.success(`Updated to ${latest}. Restart your terminal to use the new version.`);
}
