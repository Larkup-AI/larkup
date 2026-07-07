import path from "node:path";
import { spawn } from "node:child_process";
import { readConfig } from "@larkup-rag/core/config-store";
import { emitToDisk } from "@larkup-rag/core/generator/server-runtime";
import { log } from "../ui/logger";
import { inServerScope, requireActive } from "../lib/scope";

export async function serveCommand(options: { server?: string }) {
  await inServerScope(options.server, async () => {
    const server = await requireActive();
    const config = await readConfig();

    const isLocalLance =
      config.vectorStore === "lancedb" && config.storeConfig.mode !== "cloud";

    const dir = await emitToDisk(config);
    log.info(log.fmt.cyan("Installing minimal server dependencies…"));
    
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npm", ["install", "--omit=dev"], { cwd: dir, stdio: "inherit" });
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`npm install exited with code ${code}`))
      );
      child.on("error", reject);
    });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(server.port),
      TOP_K: String(config.topK),
    };

    if (isLocalLance) {
      const dbPath = config.storeConfig.dbPath || "./.larkup/lancedb";
      env.LANCEDB_MODE = "local";
      env.LANCEDB_PATH = path.isAbsolute(dbPath)
        ? dbPath
        : path.join(process.cwd(), dbPath);
      env.LANCEDB_TABLE = config.storeConfig.tableName || "documents";
    }

    log.success(`Serving ${log.fmt.bold(config.projectName)} on http://localhost:${server.port}`);
    log.dim("  POST /query  ·  GET /health  ·  Ctrl+C to stop");

    const child = spawn("node", ["server.mjs"], {
      cwd: dir,
      stdio: "inherit",
      env,
    });

    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
      process.on("SIGINT", () => child.kill("SIGINT"));
      process.on("SIGTERM", () => child.kill("SIGTERM"));
    });
  });
}
