import { initCommand } from './init';
import { serveCommand } from './serve';
import { prompts } from '../ui/prompts';
import { getActiveServer } from '@larkup/core/workspace';

const DEFAULT_PROJECT_NAME = 'my-larkup';

/** Create a workspace when needed, then run its local server in the foreground. */
export async function devCommand(name?: string) {
  const activeServer = await getActiveServer();
  if (!name?.trim() && activeServer) {
    await serveCommand({ server: activeServer.id });
    return;
  }

  const projectName =
    name?.trim() ||
    (await prompts.text({
      message: 'Project name',
      initialValue: DEFAULT_PROJECT_NAME,
      placeholder: DEFAULT_PROJECT_NAME,
    }));

  const server = await initCommand(projectName.trim() || DEFAULT_PROJECT_NAME);
  await serveCommand({ server: server.id });
}
