import { getActiveProject, runWithProject, type ProjectMeta } from '@larkup/core/project-store';
import { log } from '../ui/logger';

/** Run a body either in the active Project scope or a specific Project id. */
export async function inProjectScope<T>(
  projectId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (projectId) {
    const found = await runWithProject(projectId, () => getActiveProject());
    if (!found) log.error(`No Project with id "${projectId}".`);
    return runWithProject(projectId, fn);
  }
  return fn();
}

/** Get the active Project or fail if none exists. */
export async function requireActiveProject(): Promise<ProjectMeta> {
  const project = await getActiveProject();
  if (!project) {
    log.error('No active Project. Start one with: larkup dev');
  }
  return project as ProjectMeta;
}
