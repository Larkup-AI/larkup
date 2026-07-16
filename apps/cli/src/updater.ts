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

export async function checkUpdate(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    const res = await fetch(VERSION_CHECK_URL, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return;

    const data = (await res.json()) as { version?: string };
    const currentVersion = pkg.version;

    if (data.version && compareVersions(data.version, currentVersion) > 0) {
      console.log("");
      log.info(`╭──────────────────────────────────────────────╮`);
      log.info(
        `│  Update available: ${currentVersion} → ${data.version}${" ".repeat(25 - currentVersion.length - data.version.length)}│`,
      );
      log.info(
        `│  Run: ${log.fmt.cyan("npm install -g @larkup/cli")}             │`,
      );
      log.info(`╰──────────────────────────────────────────────╯`);
      console.log("");
    }
  } catch {
    // Fail silently, don't interrupt the CLI flow
  }
}
