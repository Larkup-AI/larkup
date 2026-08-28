import { describe, expect, it, vi, beforeEach } from 'vitest';

const runCommandMock = vi.fn();
const stopMock = vi.fn();
const createMock = vi.fn();
const listMock = vi.fn();

vi.mock('@vercel/sandbox', () => ({
  Sandbox: { create: createMock, list: listMock },
}));

const { vercelAdapter } = await import('./vercel.js');

const fields = { token: 'tok', teamId: 'team_1', projectId: 'prj_1' };

beforeEach(() => {
  runCommandMock.mockReset();
  stopMock.mockReset();
  createMock.mockReset();
  listMock.mockReset();
  createMock.mockResolvedValue({ runCommand: runCommandMock, stop: stopMock });
  vi.stubGlobal('fetch', vi.fn());
});

describe('vercelAdapter.verifyCredentials', () => {
  it('requires token, teamId, and projectId', async () => {
    await expect(vercelAdapter.verifyCredentials({ token: 'tok' })).rejects.toThrow(
      'Vercel access token, team ID, and project ID are all required.',
    );
  });

  it('lists sandboxes with the submitted project credentials', async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    listMock.mockResolvedValue({ toArray });
    await vercelAdapter.verifyCredentials(fields);
    expect(listMock).toHaveBeenCalledWith(fields);
    expect(toArray).toHaveBeenCalledTimes(1);
  });

  it('surfaces a Vercel Sandbox authorization failure', async () => {
    listMock.mockRejectedValue(new Error('Forbidden'));
    await expect(vercelAdapter.verifyCredentials(fields)).rejects.toThrow('Forbidden');
  });
});

describe('vercelAdapter.execute', () => {
  it('runs the script through bash -c and reads stdout/stderr as functions', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: async () => 'result\n',
      stderr: async () => '',
    });

    const result = await vercelAdapter.execute({ code: 'print(1)', language: 'python' }, fields);

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining(fields));
    expect(runCommandMock).toHaveBeenCalledWith('bash', ['-c', expect.stringContaining('run.py')]);
    expect(result.stdout).toBe('result\n');
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it('restores a configured snapshot for each execution', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: async () => '',
      stderr: async () => '',
    });

    await vercelAdapter.execute(
      { code: 'print(1)', language: 'python' },
      { ...fields, snapshotId: 'snap_1' },
    );

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: { type: 'snapshot', snapshotId: 'snap_1' } }),
    );
  });

  it('returns a failed result without creating a sandbox when credentials are incomplete', async () => {
    const result = await vercelAdapter.execute({ code: 'x=1', language: 'python' }, { token: 'tok' });
    expect(result.exitCode).toBe(1);
    expect(createMock).not.toHaveBeenCalled();
  });
});
