import { log } from "./ui/logger";
import pkg from "../package.json" with { type: "json" };

const VERSION_CHECK_URL = "https://larkup.de/api/version";

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export function isVersionNewer(candidate: string, current: string) {
  return compareVersions(candidate, current) > 0;
}

export async function getLatestVersion(): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(VERSION_CHECK_URL, { signal: controller.signal });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { version?: string };
    return data.version;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkUpdate(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;

  try {
    const version = await getLatestVersion();
    const currentVersion = pkg.version;

    if (version && isVersionNewer(version, currentVersion)) {
      console.log("");
      log.info(`╭──────────────────────────────────────────────╮`);
      log.info(
        `│  Update available: ${currentVersion} → ${version}${" ".repeat(Math.max(1, 25 - currentVersion.length - version.length))}│`,
      );
      log.info(
        `│  Run: ${log.fmt.cyan("larkup update")}                         │`,
      );
      log.info(`╰──────────────────────────────────────────────╯`);
      console.log("");
    }
  } catch {
    // Fail silently, don't interrupt the CLI flow
  }
}
