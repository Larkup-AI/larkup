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
      'local',
      'custom-remote',
    ]);
    expect(
      manifest.configSchema.find((field: { key: string }) => field.key === 'audioProvider')
        .visibleWhen,
    ).toBeUndefined();
    expect(
      manifest.configSchema.find((field: { key: string }) => field.key === 'audioProvider'),
    ).toMatchObject({
      defaultValue: 'deepgram',
      options: expect.not.arrayContaining([
        expect.objectContaining({ value: 'larkup-cloud' }),
        expect.objectContaining({ value: 'local' }),
      ]),
    });
    const indexingSurface = manifest.ui.surfaces.find(
      (surface: { id: string }) => surface.id === 'video-indexing-brief',
    );
    expect(indexingSurface).toMatchObject({
      appliesTo: ['video'],
      estimate: {
        modeField: 'indexingMode',
        variants: expect.arrayContaining([
          expect.objectContaining({ value: 'fast' }),
          expect.objectContaining({ value: 'balanced' }),
          expect.objectContaining({ value: 'thorough' }),
        ]),
      },
      form: {
        fields: expect.arrayContaining([
          expect.objectContaining({ key: 'goal', type: 'textarea' }),
          expect.objectContaining({
            key: 'indexingMode',
            type: 'select',
            options: expect.arrayContaining([
              expect.objectContaining({ value: 'fast' }),
              expect.objectContaining({ value: 'balanced' }),
              expect.objectContaining({ value: 'thorough' }),
            ]),
          }),
        ]),
      },
    });
    expect(
      indexingSurface.estimate.variants.map((variant: { value: string }) => variant.value),
    ).toEqual(['fast', 'balanced', 'thorough']);
    expect(
      manifest.configSchema.find((field: { key: string }) => field.key === 'videoVisionProvider'),
    ).toMatchObject({ defaultFromGlobalConfigKey: 'visionProvider' });
    expect(
      manifest.configSchema.find((field: { key: string }) => field.key === 'semanticVisionModel'),
    ).toMatchObject({ defaultFromGlobalConfigKey: 'visionModelId' });
    expect(
      manifest.configSchema.find((field: { key: string }) => field.key === 'videoAgentProvider'),
    ).toMatchObject({
      defaultFromGlobalConfigKey: 'chatProvider',
      options: expect.arrayContaining([expect.objectContaining({ value: 'deepseek' })]),
    });
    expect(
      manifest.configSchema.find((field: { key: string }) => field.key === 'agentModel'),
    ).toMatchObject({ defaultFromGlobalConfigKey: 'chatModelId' });
    for (const key of ['videoVisionApiKey', 'videoAgentApiKey']) {
      expect(
        manifest.configSchema.find((field: { key: string }) => field.key === key),
      ).toMatchObject({ type: 'password' });
    }
    expect(
      manifest.configSchema.find((field: { key: string }) => field.key === 'audioModel'),
    ).toBeUndefined();
    expect(
      manifest.configSchema.find((field: { key: string }) => field.key === 'audioProvider')
        .visibleWhen,
    ).toBeUndefined();
    expect(manifest.configSchema).toContainEqual(
      expect.objectContaining({
        key: 'cloudAccessKey',
        type: 'password',
        visibleWhen: { field: 'runtimeMode', equals: 'managed-cloud' },
      }),
    );
  });
});
