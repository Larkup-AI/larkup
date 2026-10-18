import { describe, expect, it } from 'vitest';
import { runWithWorkspaceHost, type WorkspaceHost } from '@larkup/core/workspace-host';
import { buildNpmInstallArgs, getInstalledTools } from './tool-installer';

describe('buildNpmInstallArgs', () => {
  it('refreshes registry metadata and preserves scoped package specifiers', () => {
    expect(
      buildNpmInstallArgs('@larkup/tool-video-intelligence@latest', '/tmp/larkup-tools'),
    ).toEqual([
      'install',
      '@larkup/tool-video-intelligence@latest',
      '--prefix',
      '/tmp/larkup-tools',
      '--save',
      '--no-audit',
      '--no-fund',
      '--prefer-online',
    ]);
  });
});

describe('getInstalledTools', () => {
  it('uses managed host tools without a mutable filesystem manifest', async () => {
    const tools = await runWithWorkspaceHost(
      {
        tools: [
          {
            id: 'hosted-fixture',
            version: '1.0.0',
            installedAt: new Date(0).toISOString(),
            packageName: '@larkup/hosted-fixture',
            resolvedPath: '@larkup/hosted-fixture',
            source: 'local',
            config: { mode: 'managed' },
            module: { ready: true },
          },
        ],
      } as unknown as WorkspaceHost,
      () => getInstalledTools(),
    );
    expect(tools).toEqual([
      {
        id: 'hosted-fixture',
        version: '1.0.0',
        installedAt: new Date(0).toISOString(),
        packageName: '@larkup/hosted-fixture',
        resolvedPath: '@larkup/hosted-fixture',
        source: 'local',
        config: { mode: 'managed' },
      },
    ]);
  });
});
