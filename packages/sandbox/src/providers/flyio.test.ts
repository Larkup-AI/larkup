import { describe, expect, it, vi, beforeEach } from 'vitest';

const execMock = vi.fn();
const deleteMock = vi.fn();
const createSpriteMock = vi.fn();
let listSpritesMock: ReturnType<typeof vi.fn> | undefined;

vi.mock('@fly/sprites', () => ({
  SpritesClient: vi.fn().mockImplementation(function () {
    return { createSprite: createSpriteMock, listSprites: listSpritesMock };
  }),
}));

const { flyioAdapter } = await import('./flyio.js');

beforeEach(() => {
  execMock.mockReset();
  deleteMock.mockReset();
  createSpriteMock.mockReset();
  listSpritesMock = undefined;
  createSpriteMock.mockResolvedValue({ exec: execMock, delete: deleteMock });
});

describe('flyioAdapter.verifyCredentials', () => {
  it('requires a token', async () => {
    await expect(flyioAdapter.verifyCredentials({})).rejects.toThrow('Fly Sprites token is required.');
  });

  it('falls back to a throwaway sprite when listSprites is not exposed', async () => {
    await flyioAdapter.verifyCredentials({ token: 't' });
    expect(createSpriteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});

describe('flyioAdapter.execute — ExecError handling', () => {
  it('reports exitCode 0 on a plain successful exec', async () => {
    execMock.mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    const result = await flyioAdapter.execute({ code: 'print(1)', language: 'python' }, { token: 't' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok\n');
  });

  it('extracts exitCode/stdout/stderr from a thrown ExecError', async () => {
    const execError = Object.assign(new Error('non-zero exit'), {
      exitCode: 7,
      stdout: 'partial\n',
      stderr: 'failure detail',
    });
    execMock.mockRejectedValue(execError);

    const result = await flyioAdapter.execute({ code: 'exit(7)', language: 'python' }, { token: 't' });
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe('failure detail');
  });

  it('rethrows and produces a failed result for errors without an exitCode', async () => {
    execMock.mockRejectedValue(new Error('network down'));
    const result = await flyioAdapter.execute({ code: 'x=1', language: 'python' }, { token: 't' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('network down');
  });

  it('always deletes the sprite afterward', async () => {
    execMock.mockResolvedValue({ stdout: '', stderr: '' });
    await flyioAdapter.execute({ code: 'x=1', language: 'python' }, { token: 't' });
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
