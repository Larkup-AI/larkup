import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readConfig } from '@larkup/core/config-store';
import { generateServer } from '@larkup/core/generator/generate-server';
import { emitToDisk } from '@larkup/core/generator/server-runtime';
import { log } from '../ui/logger';
import { inProjectScope, requireActiveProject } from '../lib/scope';

export async function generateCommand(options: { project?: string; out?: string }) {
  await inProjectScope(options.project, async () => {
    await requireActiveProject();
    const config = await readConfig();

    if (options.out) {
      const dir = path.isAbsolute(options.out)
        ? options.out
        : path.join(process.cwd(), options.out);
      const server = generateServer(config);
      await fs.mkdir(dir, { recursive: true });
      for (const f of server.files) {
        const dest = path.join(dir, f.path);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, f.contents, 'utf8');
      }
      log.success(`Generated ${server.files.length} files → ${dir}`);
    } else {
      const dir = await emitToDisk(config);
      const server = generateServer(config);
      log.success(`Generated ${server.files.length} files → ${dir}`);
    }

    const server = generateServer(config);
    const deps = Object.entries(server.dependencies)
      .map(([k, v]) => `${k}@${v}`)
      .join(', ');

    log.dim(`  deps: ${deps}`);
    log.dim('  run it locally with: larkup serve');
  });
}
