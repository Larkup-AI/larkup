import { promises as fs } from "node:fs";
import path from "node:path";
import { readConfig } from "@larkup/core/config-store";
import { emitAgentToDisk, emitToDisk, startAgentServer, startServer } from "@larkup/core/generator/server-runtime";
import { log } from "../ui/logger";
import { inServerScope, requireActive } from "../lib/scope";

interface DeployOptions {
  server?: string;
  out?: string;
  start?: boolean;
}

export async function deployCommand(target: string | undefined, options: DeployOptions) {
  await inServerScope(options.server, async () => {
    await requireActive();
    const config = await readConfig();
    const normalizedTarget = target || "docker";

    if (normalizedTarget === "local") {
      const state = await startServer(config);
      if (!state.running) log.error(state.lastError || "The local server did not start.");
      log.success(`Local server running at ${state.endpoint}`);
      return;
    }

    if (normalizedTarget === "agent") {
      if (options.out) {
        const output = await copyGenerated(await emitAgentToDisk(config), options.out);
        log.success(`Generated agent server → ${output}`);
      } else if (options.start) {
        const state = await startAgentServer(config);
        if (!state.running) log.error(state.lastError || "The agent server did not start.");
        log.success(`Agent server running at ${state.endpoint}`);
      } else {
        log.success(`Generated agent server → ${await emitAgentToDisk(config)}`);
      }
      return;
    }

    if (!["docker", "vercel", "export"].includes(normalizedTarget)) {
      log.error(`Unknown deploy target "${normalizedTarget}". Use docker, vercel, local, agent, or export.`);
    }

    const generated = await emitToDisk(config);
    const output = options.out ? await copyGenerated(generated, options.out) : generated;
    log.success(`Deployment artifact ready → ${output}`);
    if (normalizedTarget === "docker") log.info(`  cd ${output} && docker compose up -d --build`);
    if (normalizedTarget === "vercel") log.info(`  cd ${output} && vercel deploy`);
  });
}

async function copyGenerated(source: string, output: string) {
  const destination = path.resolve(output);
  const relative = path.relative(source, destination);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("Deployment output must be outside the generated server directory.");
  }
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true });
  return destination;
}
