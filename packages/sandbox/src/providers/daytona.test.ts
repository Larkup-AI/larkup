import { describe, expect, it, vi, beforeEach } from 'vitest';

const executeCommandMock = vi.fn();
const deleteMock = vi.fn();
const createMock = vi.fn();
const listMock = vi.fn();

vi.mock('@daytona/sdk', () => ({
  Daytona: vi.fn().mockImplementation(function () {
    return { create: createMock, list: listMock };
  }),
}));

const { daytonaAdapter } = await import('./daytona.js');

beforeEach(() => {
  executeCommandMock.mockReset();
  deleteMock.mockReset();
  createMock.mockReset();
  listMock.mockReset();
  createMock.mockResolvedValue({
    process: { executeCommand: executeCommandMock },
    delete: deleteMock,
  });
});

describe('daytonaAdapter.verifyCredentials', () => {
  it('requires an API key', async () => {
    await expect(daytonaAdapter.verifyCredentials({})).rejects.toThrow(
      'Daytona API key is required.',
    );
  });

  it('uses list() as the cheap credential check', async () => {
    const next = vi.fn().mockResolvedValue({ done: true, value: undefined });
    listMock.mockReturnValue({ next });
    await daytonaAdapter.verifyCredentials({ apiKey: 'dtn_1' });
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('daytonaAdapter.execute — merged stdout/stderr', () => {
  it('puts successful output in stdout only', async () => {
    executeCommandMock.mockResolvedValue({ exitCode: 0, result: 'all good\n' });
    const result = await daytonaAdapter.execute(
      { code: 'print(1)', language: 'python' },
      { apiKey: 'k' },
    );
    expect(result.stdout).toBe('all good\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('mirrors the combined output into stderr when the command fails', async () => {
    executeCommandMock.mockResolvedValue({ exitCode: 1, result: 'Traceback...\n' });
    const result = await daytonaAdapter.execute(
      { code: 'raise ValueError()', language: 'python' },
      { apiKey: 'k' },
    );
    expect(result.stdout).toBe('Traceback...\n');
    expect(result.stderr).toBe('Traceback...\n');
    expect(result.exitCode).toBe(1);
  });

  it('always deletes the sandbox afterward', async () => {
    executeCommandMock.mockResolvedValue({ exitCode: 0, result: '' });
    await daytonaAdapter.execute({ code: 'x=1', language: 'python' }, { apiKey: 'k' });
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
