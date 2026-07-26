import { createServer, type ServerMeta } from '@larkup/core/workspace';
import { log } from '../ui/logger';

export async function initCommand(name = 'my-larkup'): Promise<ServerMeta> {
  const projectName = name.trim() || 'my-larkup';
  const { server } = await createServer(projectName);

  log.success(`Created server ${log.fmt.bold(server.name)}`);
  log.dim(`  id   ${server.id}`);
  log.dim(`  port ${server.port}  (the generated server listens here)`);
  log.dim('  it is now the active server');
  return server;
}
