import { describe, expect, it, vi, beforeEach } from 'vitest';

const listMock = vi.fn();
const runMock = vi.fn();
const killMock = vi.fn();
const createMock = vi.fn();

vi.mock('e2b', () => ({
  Sandbox: {
    list: listMock,
    create: createMock,
  },
}));

const { e2bAdapter } = await import('./e2b.js');

beforeEach(() => {
  listMock.mockReset();
  runMock.mockReset();
  killMock.mockReset();
  createMock.mockReset();
  createMock.mockResolvedValue({ commands: { run: runMock }, kill: killMock });
});

describe('e2bAdapter.verifyCredentials', () => {
  it('rejects without calling the SDK when the API key is missing', async () => {
    await expect(e2bAdapter.verifyCredentials({})).rejects.toThrow('E2B API key is required.');
    expect(listMock).not.toHaveBeenCalled();
  });

  it('lists sandboxes as a cheap credential check', async () => {
    const nextItems = vi.fn().mockResolvedValue([]);
    listMock.mockReturnValue({ nextItems });
    await e2bAdapter.verifyCredentials({ apiKey: 'e2b_test' });
    expect(listMock).toHaveBeenCalledWith({ apiKey: 'e2b_test' });
    expect(nextItems).toHaveBeenCalledTimes(1);
  });

  it('propagates the SDK error on an invalid key', async () => {
    listMock.mockReturnValue({ nextItems: vi.fn().mockRejectedValue(new Error('401 unauthorized')) });
    await expect(e2bAdapter.verifyCredentials({ apiKey: 'bad' })).rejects.toThrow('401 unauthorized');
  });
});

describe('e2bAdapter.healthCheck', () => {
  it('reports missing-credentials without touching the SDK', async () => {
    const result = await e2bAdapter.healthCheck({});
    expect(result).toEqual({ status: 'missing-credentials', backend: 'e2b', error: 'E2B API key is required.' });
    expect(listMock).not.toHaveBeenCalled();
  });

  it('reports ready when verification succeeds', async () => {
    listMock.mockReturnValue({ nextItems: vi.fn().mockResolvedValue([]) });
    const result = await e2bAdapter.healthCheck({ apiKey: 'good' });
    expect(result.status).toBe('ready');
  });
});

describe('e2bAdapter.execute', () => {
  it('fails fast without creating a sandbox when the API key is missing', async () => {
    const result = await e2bAdapter.execute({ code: 'print(1)', language: 'python' }, {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('E2B API key is required.');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('creates a sandbox, runs the script, and always kills it afterward', async () => {
    runMock.mockResolvedValue({ stdout: 'hi\n', stderr: '', exitCode: 0 });
    const result = await e2bAdapter.execute({ code: 'print("hi")', language: 'python' }, { apiKey: 'key' });

    expect(createMock).toHaveBeenCalled();
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(result.stdout).toBe('hi\n');
    expect(result.exitCode).toBe(0);
    expect(killMock).toHaveBeenCalledTimes(1);
  });

  it('starts from a configured snapshot when one is supplied', async () => {
    runMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    await e2bAdapter.execute(
      { code: 'print(1)', language: 'python' },
      { apiKey: 'key', snapshotId: 'larkup-python:latest' },
    );

    expect(createMock).toHaveBeenCalledWith(
      'larkup-python:latest',
      expect.objectContaining({ allowInternetAccess: false }),
    );
  });

  it('still kills the sandbox and returns a failed result when the run call throws', async () => {
    runMock.mockRejectedValue(new Error('command failed'));
    const result = await e2bAdapter.execute({ code: 'x=1', language: 'python' }, { apiKey: 'key' });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('command failed');
    expect(killMock).toHaveBeenCalledTimes(1);
  });
});
