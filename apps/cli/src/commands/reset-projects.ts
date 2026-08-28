import path from 'node:path';
import { resetLocalProjects } from '@larkup/core/project-store';
import { log } from '../ui/logger';

/** Explicitly clears local Project data after an exact-path confirmation. */
export async function resetProjectsCommand(confirmationPath: string | undefined) {
  const target = path.join(process.cwd(), '.larkup', 'projects');
  if (confirmationPath !== target) {
    log.error(`Refusing reset. Re-run with: larkup reset-projects --confirm "${target}"`);
    return;
  }
  await resetLocalProjects(confirmationPath);
  log.success(`Removed local Projects at ${target}`);
}
