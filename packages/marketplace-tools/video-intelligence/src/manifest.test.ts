import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateToolManifest } from '@larkup/marketplace/manifest';

describe('tool.manifest.json', () => {
  it('is a valid Marketplace v3 manifest aligned with the package', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../tool.manifest.json', import.meta.url), 'utf8'),
    );
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(validateToolManifest(manifest)).toMatchObject({ valid: true, errors: [] });
    expect(manifest.manifestVersion).toBe('3.0');
    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.packageName).toBe(packageJson.name);
    expect(manifest.runtime.modes.map((mode: { id: string }) => mode.id)).toEqual([
      'managed-cloud',
      'local-docker',
      'custom-remote',
    ]);
    expect(manifest.configSchema.find((field: { key: string }) => field.key === 'audioProvider').visibleWhen).toEqual({
      field: 'runtimeMode',
      equals: 'managed-cloud',
    });
  });
});
