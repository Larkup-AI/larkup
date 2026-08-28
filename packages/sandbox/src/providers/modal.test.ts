import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientConstructorMock = vi.fn();
const imageBuilderVersionMock = vi.fn();
const appFromNameMock = vi.fn();
const imageFromRegistryMock = vi.fn();
const sandboxCreateMock = vi.fn();
const execMock = vi.fn();
const terminateMock = vi.fn();
const closeMock = vi.fn();
const stdoutReadMock = vi.fn();
const stderrReadMock = vi.fn();
const waitMock = vi.fn();

vi.mock('modal', () => ({
  ModalClient: class {
    apps = { fromName: appFromNameMock };
    images = { fromRegistry: imageFromRegistryMock };
    sandboxes = { create: sandboxCreateMock };
    getImageBuilderVersion = imageBuilderVersionMock;
    close = closeMock;

    constructor(options: unknown) {
      clientConstructorMock(options);
    }
  },
}));

const { modalAdapter } = await import('./modal.js');

const fields = { tokenId: 'ak-123', tokenSecret: 'as-456' };

beforeEach(() => {
  clientConstructorMock.mockReset();
  imageBuilderVersionMock.mockReset();
  appFromNameMock.mockReset();
  imageFromRegistryMock.mockReset();
  sandboxCreateMock.mockReset();
  execMock.mockReset();
  terminateMock.mockReset();
  closeMock.mockReset();
  stdoutReadMock.mockReset();
  stderrReadMock.mockReset();
  waitMock.mockReset();

  imageBuilderVersionMock.mockResolvedValue('2026.1');
  appFromNameMock.mockResolvedValue({ appId: 'ap-123' });
  imageFromRegistryMock.mockReturnValue({ imageId: 'im-123' });
  sandboxCreateMock.mockResolvedValue({ exec: execMock, terminate: terminateMock });
  stdoutReadMock.mockResolvedValue('done\n');
  stderrReadMock.mockResolvedValue('');
  waitMock.mockResolvedValue(0);
  execMock.mockResolvedValue({
    stdout: { readText: stdoutReadMock },
    stderr: { readText: stderrReadMock },
    wait: waitMock,
  });
  terminateMock.mockResolvedValue(undefined);
});

describe('modalAdapter', () => {
  it('rejects immediately when either token field is missing', async () => {
    await expect(
      modalAdapter.execute({ code: 'x=1', language: 'python' }, { tokenId: 'ak-1' }),
    ).resolves.toMatchObject({ exitCode: 1 });
    expect(clientConstructorMock).not.toHaveBeenCalled();
  });

  it('verifies credentials through the current Modal client API', async () => {
    await expect(modalAdapter.healthCheck(fields)).resolves.toMatchObject({ status: 'ready' });
    expect(clientConstructorMock).toHaveBeenCalledWith(fields);
    expect(imageBuilderVersionMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('creates a sandbox through the client with the runtime image for the request', async () => {
    await modalAdapter.execute({ code: 'print(1)', language: 'python', timeout: 5_000 }, fields);

    expect(appFromNameMock).toHaveBeenCalledWith('larkup-sandbox', { createIfMissing: true });
    expect(imageFromRegistryMock).toHaveBeenCalledWith('python:3.13-slim');
    expect(sandboxCreateMock).toHaveBeenCalledWith(
      { appId: 'ap-123' },
      { imageId: 'im-123' },
      { timeoutMs: 65_000, idleTimeoutMs: 35_000 },
    );
    expect(execMock).toHaveBeenCalledWith(expect.arrayContaining(['bash', '-lc']), {
      timeoutMs: 5_000,
    });
    expect(terminateMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('returns the command process exit code and output', async () => {
    stdoutReadMock.mockResolvedValue('result\n');
    stderrReadMock.mockResolvedValue('warning\n');
    waitMock.mockResolvedValue(2);

    await expect(
      modalAdapter.execute({ code: 'x=1', language: 'typescript' }, fields),
    ).resolves.toMatchObject({
      stdout: 'result\n',
      stderr: 'warning\n',
      exitCode: 2,
    });
    expect(imageFromRegistryMock).toHaveBeenCalledWith('node:22-bookworm-slim');
  });
});
