import { describe, expect, it, vi, beforeEach } from 'vitest';

const listMock = vi.fn();

vi.mock('@browserbasehq/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { projects: { list: listMock } };
  }),
}));

const { browserbaseAdapter } = await import('./browserbase.js');

beforeEach(() => {
  listMock.mockReset();
});

describe('browserbaseAdapter.execute', () => {
  it('always fails fast — Browserbase is browser automation, not a code-execution sandbox', async () => {
    const result = await browserbaseAdapter.execute({ code: 'print(1)', language: 'python' }, {
      apiKey: 'k',
      projectId: 'p',
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Playwright/Puppeteer');
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe('browserbaseAdapter.verifyCredentials', () => {
  it('requires both apiKey and projectId', async () => {
    await expect(browserbaseAdapter.verifyCredentials({ apiKey: 'k' })).rejects.toThrow(
      'Browserbase API key and project ID are both required.',
    );
  });

  it('checks that the project is visible to the API key', async () => {
    listMock.mockResolvedValue([{ id: 'other-project' }]);
    await expect(browserbaseAdapter.verifyCredentials({ apiKey: 'k', projectId: 'p' })).rejects.toThrow(
      'cannot see the given Browserbase project ID',
    );
  });

  it('succeeds when the project ID is in the returned list', async () => {
    listMock.mockResolvedValue([{ id: 'p' }]);
    await expect(browserbaseAdapter.verifyCredentials({ apiKey: 'k', projectId: 'p' })).resolves.toBeUndefined();
  });
});

describe('browserbaseAdapter.healthCheck', () => {
  it('reports status "unsupported" even when credentials are valid', async () => {
    listMock.mockResolvedValue([{ id: 'p' }]);
    const result = await browserbaseAdapter.healthCheck({ apiKey: 'k', projectId: 'p' });
    expect(result.status).toBe('unsupported');
  });
});
