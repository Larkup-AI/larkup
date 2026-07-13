import { getActiveServer, runWithServer, type ServerMeta } from "@larkup/core/workspace";
import { log } from "../ui/logger";

/** Run a body either in the active-server scope or a specific server id. */
export async function inServerScope<T>(
  serverId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (serverId) {
    const found = await runWithServer(serverId, () => getActiveServer());
    if (!found) log.error(`No server with id "${serverId}".`);
    return runWithServer(serverId, fn);
  }
  return fn();
}

/** Get the active server or fail if none exists. */
export async function requireActive(): Promise<ServerMeta> {
  const server = await getActiveServer();
  if (!server) {
    log.error('No active server. Create one first with: larkup init "my-rag"');
  }
  return server as ServerMeta;
}
