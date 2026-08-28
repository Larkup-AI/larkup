import { beforeEach, describe, expect, it, vi } from 'vitest';

const dockerRunner = vi.hoisted(() => ({
  checkDockerHealth: vi.fn(),
  ensureImage: vi.fn(),
  executeInDocker: vi.fn(),
}));
const localRunner = vi.hoisted(() => ({
  checkLocalRuntime: vi.fn(),
  executeLocally: vi.fn(),
}));

vi.mock('./docker-runner.js', () => ({
  checkDockerHealth: dockerRunner.checkDockerHealth,
  ensureImage: dockerRunner.ensureImage,
  executeInDocker: dockerRunner.executeInDocker,
  buildSandboxImage: vi.fn(),
}));

vi.mock('./providers/index.js', () => ({
  getSandboxProviderAdapter: vi.fn(),
}));
vi.mock('./local-runner.js', () => ({
  checkLocalRuntime: localRunner.checkLocalRuntime,
  executeLocally: localRunner.executeLocally,
}));

import { SandboxManager } from './sandbox-manager.js';

describe('SandboxManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a safe recovery message when Docker is unavailable', async () => {
    dockerRunner.checkDockerHealth.mockResolvedValue({
      status: 'docker-not-found',
      backend: 'docker',
      error: 'connect ENOENT /var/run/docker.sock',
    });

    const result = await new SandboxManager({ backend: 'docker' }).execute({
      code: 'print(1)',
      language: 'python',
    });

    expect(result).toMatchObject({
      exitCode: 1,
      stdout: '',
      artifacts: [],
      executionTimeMs: 0,
    });
    expect(result.stderr).toContain('Docker is not running');
    expect(result.stderr).not.toContain('/var/run/docker.sock');
    expect(dockerRunner.ensureImage).not.toHaveBeenCalled();
    expect(dockerRunner.executeInDocker).not.toHaveBeenCalled();
  });

  it('uses the local runtime by default without contacting Docker', async () => {
    localRunner.executeLocally.mockResolvedValue({
      stdout: '1\n',
      stderr: '',
      exitCode: 0,
      artifacts: [],
      executionTimeMs: 1,
    });

    const result = await new SandboxManager().execute({ code: 'print(1)', language: 'python' });

    expect(result.exitCode).toBe(0);
    expect(localRunner.executeLocally).toHaveBeenCalledOnce();
    expect(dockerRunner.checkDockerHealth).not.toHaveBeenCalled();
  });
});
