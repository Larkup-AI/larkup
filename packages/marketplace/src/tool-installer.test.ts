import { describe, expect, it } from 'vitest';
import { buildNpmInstallArgs } from './tool-installer';

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
