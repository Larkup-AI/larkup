import { createProject, type ProjectMeta } from '@larkup/core/project-store';
import { log } from '../ui/logger';

export async function initCommand(name = 'my-larkup'): Promise<ProjectMeta> {
  const projectName = name.trim() || 'my-larkup';
  const { project } = await createProject(projectName);

  log.success(`Created Project ${log.fmt.bold(project.name)}`);
  log.dim(`  id   ${project.id}`);
  log.dim(`  port ${project.port}  (the Project Runtime listens here)`);
  log.dim('  it is now the active Project');
  return project;
}
