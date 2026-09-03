import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readConfig } from '@larkup/core/config-store';
import { emitToDisk, startServer } from '@larkup/core/generator/server-runtime';
import { log } from '../ui/logger';
import { inProjectScope, requireActiveProject } from '../lib/scope';

interface DeployOptions {
  project?: string;
  out?: string;
  start?: boolean;
}

export async function deployCommand(target: string | undefined, options: DeployOptions) {
  await inProjectScope(options.project, async () => {
    await requireActiveProject();
    const config = await readConfig();
    const normalizedTarget = target || 'docker';

    if (normalizedTarget === 'local') {
      const state = await startServer(config);
      if (!state.running) log.error(state.lastError || 'The local server did not start.');
      log.success(`Local server running at ${state.endpoint}`);
      return;
    }

    if (!['docker', 'vercel', 'export', 'knowledge', 'assistant'].includes(normalizedTarget)) {
      log.error(
        `Unknown deploy target "${normalizedTarget}". Use docker, vercel, local, knowledge, assistant, or export.`,
      );
    }

    const generated = await emitToDisk(config);
    const output = options.out ? await copyGenerated(generated, options.out) : generated;
    log.success(`Deployment artifact ready → ${output}`);
    if (normalizedTarget === 'docker') log.info(`  cd ${output} && docker compose up -d --build`);
    if (normalizedTarget === 'vercel') log.info(`  cd ${output} && vercel deploy`);
  });
}

async function copyGenerated(source: string, output: string) {
  const destination = path.resolve(output);
  const relative = path.relative(source, destination);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Deployment output must be outside the generated server directory.');
  }
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true });
  return destination;
}
