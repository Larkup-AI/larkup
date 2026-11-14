import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export async function loadConverter() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const source = path.resolve(root, '../../../../workspace-server/src/lib/media/video-intelligence-adapter.ts');
  const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex');
  const directory = path.resolve(root, '../data/deployment');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const output = path.join(directory, `evidence-converter-${sourceHash}.mjs`);
  try { await readFile(output); } catch {
    const coreRequire = createRequire(new URL('../../../../core/package.json', import.meta.url));
    const tsxRequire = createRequire(coreRequire.resolve('tsx/package.json'));
    const { build } = await import(pathToFileURL(tsxRequire.resolve('esbuild')));
    const result = await build({ entryPoints: [path.join(root, 'evidence-converter-entry.mjs')],
      bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, treeShaking: true,
      plugins: [{ name: 'pure-canonical-converter', setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => args.importer === source
          ? { path: args.path, external: true, sideEffects: false } : undefined);
      } }] });
    if (Object.values(result.metafile.outputs).some((o) => o.imports.some((i) => !i.path.startsWith('node:')))) {
      throw Error('Canonical converter no longer isolates to pure functions; review its dependencies.');
    }
    const temporary = output + '.' + randomUUID();
    await writeFile(temporary, result.outputFiles[0].contents, { mode: 0o600 });
    await rename(temporary, output);
  }
  return import(pathToFileURL(output));
}
