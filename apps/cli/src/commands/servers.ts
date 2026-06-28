import { getWorkspace, setActiveServer } from "@larkup-rag/core/workspace";
import { log } from "../ui/logger";

export async function listServersCommand() {
  const ws = await getWorkspace();
  if (ws.servers.length === 0) {
    log.dim('No servers yet. Create one with: larkuprag init "my-rag"');
    return;
  }
  
  log.bold("Servers");
  for (const s of ws.servers) {
    const active = s.id === ws.activeServerId;
    const marker = active ? log.fmt.green("●") : log.fmt.dim("○");
    log.info(`${marker} ${log.fmt.bold(s.name)} ${log.fmt.dim(`:${s.port}`)} ${log.fmt.dim(s.id)}`);
  }
}

export async function useServerCommand(target: string) {
  const ws = await getWorkspace();
  // Match by id first, then fall back to an exact name match.
  const next =
    ws.servers.find((s) => s.id === target) ??
    ws.servers.find((s) => s.name === target);
    
  if (!next) {
    log.error(`No server matching "${target}".`);
  }
  
  await setActiveServer(next.id);
  log.success(`Active server is now ${log.fmt.bold(next.name)}`);
}
