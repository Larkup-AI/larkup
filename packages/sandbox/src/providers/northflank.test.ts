import { describe, expect, it, vi, beforeEach } from 'vitest';

const deploymentMock = vi.fn();
const getProjectMock = vi.fn();
const getServiceMock = vi.fn();
const deleteServiceMock = vi.fn();
const execServiceSessionMock = vi.fn();
const addContextMock = vi.fn();

vi.mock('@northflank/js-client', () => ({
  ApiClient: vi.fn().mockImplementation(function () {
    return {
      create: { service: { deployment: deploymentMock } },
      get: { project: getProjectMock, service: getServiceMock },
      delete: { service: deleteServiceMock },
      exec: { execServiceSession: execServiceSessionMock },
    };
  }),
  ApiClientInMemoryContextProvider: vi.fn().mockImplementation(function () {
    return { addContext: addContextMock };
  }),
}));

const { northflankAdapter } = await import('./northflank.js');

const fields = { token: 'tok', projectId: 'proj_1' };

function makeExecHandle(stdout: string, stderr: string, exitCode: number) {
  return {
    stdOut: { on: (_event: string, cb: (chunk: string) => void) => cb(stdout) },
    stdErr: { on: (_event: string, cb: (chunk: string) => void) => cb(stderr) },
    waitForCommandResult: vi.fn().mockResolvedValue({ exitCode }),
  };
}

beforeEach(() => {
  deploymentMock.mockReset();
  getProjectMock.mockReset();
  getServiceMock.mockReset();
  deleteServiceMock.mockReset();
  execServiceSessionMock.mockReset();
  addContextMock.mockReset();
  deploymentMock.mockResolvedValue({});
  getProjectMock.mockResolvedValue({ data: { id: 'proj_1' } });
  getServiceMock.mockResolvedValue({ data: { status: 'COMPLETED' } });
  deleteServiceMock.mockResolvedValue({});
});

describe('northflankAdapter.verifyCredentials', () => {
  it('requires both token and projectId', async () => {
    await expect(northflankAdapter.verifyCredentials({ token: 'tok' })).rejects.toThrow(
      'Northflank API token and project ID are both required.',
    );
  });

  it('checks the project with the authenticated API client', async () => {
    await northflankAdapter.verifyCredentials(fields);
    expect(getProjectMock).toHaveBeenCalledWith({ parameters: { projectId: 'proj_1' } });
  });

  it('rejects a project ID that the token cannot access', async () => {
    getProjectMock.mockRejectedValue(new Error('Northflank API returned 404.'));
    await expect(
      northflankAdapter.verifyCredentials({ token: 'tok', projectId: 'missing-project' }),
    ).rejects.toThrow('404');
  });
});

describe('northflankAdapter.execute', () => {
  it('creates a service, waits for it to be ready, execs, and deletes it', async () => {
    execServiceSessionMock.mockResolvedValue(makeExecHandle('out\n', '', 0));

    const result = await northflankAdapter.execute(
      { code: 'print(1)', language: 'python' },
      fields,
    );

    expect(deploymentMock).toHaveBeenCalledTimes(1);
    expect(getServiceMock).toHaveBeenCalled();
    expect(execServiceSessionMock).toHaveBeenCalledTimes(1);
    expect(result.stdout).toBe('out\n');
    expect(result.exitCode).toBe(0);
    expect(deleteServiceMock).toHaveBeenCalledTimes(1);
  });

  it('aggregates stdErr stream chunks into ExecutionResult.stderr', async () => {
    execServiceSessionMock.mockResolvedValue(makeExecHandle('', 'boom', 1));
    const result = await northflankAdapter.execute({ code: 'x=1', language: 'python' }, fields);
    expect(result.stderr).toBe('boom');
    expect(result.exitCode).toBe(1);
  });

  it('throws when the service reports FAILED while waiting for readiness', async () => {
    getServiceMock.mockResolvedValue({ data: { status: 'FAILED' } });
    const result = await northflankAdapter.execute({ code: 'x=1', language: 'python' }, fields);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('failed to start');
    // Cleanup still runs even though the service never became ready.
    expect(deleteServiceMock).toHaveBeenCalledTimes(1);
  });

  it('returns a failed result without calling the API when projectId is missing', async () => {
    const result = await northflankAdapter.execute(
      { code: 'x=1', language: 'python' },
      { token: 'tok' },
    );
    expect(result.exitCode).toBe(1);
    expect(deploymentMock).not.toHaveBeenCalled();
  });
});
