import { getProjectWorkspace, setActiveProject } from '@larkup/core/project-store';
import { log } from '../ui/logger';

export async function listProjectsCommand() {
  const workspace = await getProjectWorkspace();
  if (workspace.projects.length === 0) {
    log.dim('No Projects yet. Create one with: larkup init');
    return;
  }

  log.bold('Projects');
  for (const s of workspace.projects) {
    const active = s.id === workspace.activeProjectId;
    const marker = active ? log.fmt.green('●') : log.fmt.dim('○');
    log.info(`${marker} ${log.fmt.bold(s.name)} ${log.fmt.dim(`:${s.port}`)} ${log.fmt.dim(s.id)}`);
  }
}

export async function useProjectCommand(target: string) {
  const workspace = await getProjectWorkspace();
  const next =
    workspace.projects.find((s) => s.id === target) ??
    workspace.projects.find((s) => s.name === target);

  if (!next) {
    log.error(`No Project matching "${target}".`);
    return;
  }

  await setActiveProject(next.id);
  log.success(`Active Project is now ${log.fmt.bold(next.name)}`);
}
