import { getAllTools, getToolById } from "@larkup/marketplace/registry";
import {
  getInstalledTool,
  getInstalledTools,
  installTool,
  uninstallTool,
} from "@larkup/marketplace/installer";
import { log } from "../ui/logger";

export async function marketplaceCommand(action = "list", toolId?: string) {
  if (action === "list") {
    const [tools, installed] = await Promise.all([getAllTools(), getInstalledTools()]);
    const installedIds = new Set(installed.map((tool) => tool.id));

    if (tools.length === 0) {
      log.dim("No marketplace tools are available.");
      return;
    }

    for (const tool of tools) {
      const state = tool.comingSoon ? "coming soon" : installedIds.has(tool.id) ? "installed" : "available";
      log.info(`${log.fmt.cyan(tool.id)}  ${tool.name}  ${log.fmt.dim(state)}`);
    }
    return;
  }

  if (!toolId) {
    log.error(`Usage: larkup marketplace ${action} <tool-id>`);
  }

  if (action === "info") {
    const tool = await getToolById(toolId!);
    if (!tool) log.error(`No marketplace tool named "${toolId}".`);
    const installed = await getInstalledTool(toolId!);
    log.bold(tool!.name);
    log.info(`  id          ${tool!.id}`);
    log.info(`  version     ${tool!.version}`);
    log.info(`  status      ${installed ? "installed" : tool!.comingSoon ? "coming soon" : "available"}`);
    log.info(`  capabilities ${(tool!.capabilities ?? []).join(", ") || "none"}`);
    log.dim(`  ${tool!.description}`);
    return;
  }

  if (action === "install") {
    await installTool(toolId!, (progress) => log.dim(`  ${progress.percent}% ${progress.message}`));
    log.success(`Installed ${toolId}.`);
    return;
  }

  if (action === "uninstall") {
    await uninstallTool(toolId!);
    log.success(`Uninstalled ${toolId}.`);
    return;
  }

  log.error(`Unknown marketplace action "${action}". Use list, info, install, or uninstall.`);
}
