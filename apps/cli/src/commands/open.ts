import { spawn } from 'node:child_process';
import { getActiveProject } from '@larkup/core/project-store';
import { log } from '../ui/logger';
import { inProjectScope, requireActiveProject } from '../lib/scope';

export async function openCommand(target: string | undefined, options: { project?: string }) {
  await inProjectScope(options.project, async () => {
    const needsServer = target === 'api' || Boolean(target && !/^https?:\/\//.test(target));
    if (needsServer) await requireActiveProject();
    const project = needsServer ? await getActiveProject() : undefined;
    const url = resolveUrl(target, project?.port);
    const [command, args] = openCommandForPlatform(url);
    const child = await new Promise<ReturnType<typeof spawn>>((resolve, reject) => {
      const process = spawn(command, args, { detached: true, stdio: 'ignore' });
      process.once('spawn', () => resolve(process));
      process.once('error', reject);
    });
    child.unref();
    log.success(`Opening ${url}`);
  });
}

function resolveUrl(target: string | undefined, port: number | undefined) {
  if (!target || target === 'web') return process.env.LARKUP_WEB_URL || 'http://localhost:4567';
  if (target === 'api') return `http://localhost:${port ?? 8080}/reference`;
  if (/^https?:\/\//.test(target)) return target;
  return `http://localhost:${port ?? 8080}/${target.replace(/^\//, '')}`;
}

function openCommandForPlatform(url: string): [string, string[]] {
  if (process.platform === 'darwin') return ['open', [url]];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}
