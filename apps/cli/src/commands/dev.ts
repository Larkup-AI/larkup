import { initCommand } from './init';
import { serveCommand } from './serve';
import { prompts } from '../ui/prompts';
import { getActiveProject } from '@larkup/core/project-store';

const DEFAULT_PROJECT_NAME = 'my-larkup';

/** Create a workspace when needed, then run its local server in the foreground. */
export async function devCommand(name?: string) {
  const activeProject = await getActiveProject();
  if (!name?.trim() && activeProject) {
    await serveCommand({ project: activeProject.id });
    return;
  }

  const projectName =
    name?.trim() ||
    (await prompts.text({
      message: 'Project name',
      initialValue: DEFAULT_PROJECT_NAME,
      placeholder: DEFAULT_PROJECT_NAME,
    }));

  const project = await initCommand(projectName.trim() || DEFAULT_PROJECT_NAME);
  await serveCommand({ project: project.id });
}
