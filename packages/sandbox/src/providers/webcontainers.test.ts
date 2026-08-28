import { describe, expect, it } from 'vitest';
import { webcontainersAdapter } from './webcontainers.js';

describe('webcontainersAdapter', () => {
  it('execute() always fails — WebContainers is browser-only, no Node.js entry point', async () => {
    const result = await webcontainersAdapter.execute({ code: 'console.log(1)', language: 'javascript' }, {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cross-origin-isolated browser tab');
  });

  it('verifyCredentials always throws, since nothing here is server-checkable', async () => {
    await expect(webcontainersAdapter.verifyCredentials({})).rejects.toThrow('no server-side credential check');
    await expect(webcontainersAdapter.verifyCredentials({ apiKey: 'wc_live_key' })).rejects.toThrow();
  });

  it('healthCheck reports status "unsupported"', async () => {
    const result = await webcontainersAdapter.healthCheck({});
    expect(result.status).toBe('unsupported');
    expect(result.error).toContain('SharedArrayBuffer');
  });
});
