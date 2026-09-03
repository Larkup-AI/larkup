/**
 * Sandbox manager — high-level API for code execution.
 *
 * Provides a unified interface that routes to the appropriate backend
 * (Docker or one of the remote providers in ./providers) based on
 * configuration. Handles health checks, image setup, and execution
 * lifecycle.
 */

import type {
  SandboxConfig,
  ExecutionRequest,
  ExecutionResult,
  SandboxHealthCheck,
  DockerConfig,
} from './types.js';
import {
  checkDockerHealth,
  buildSandboxImage,
  ensureImage,
  executeInDocker,
} from './docker-runner.js';
import { checkLocalRuntime, executeLocally } from './local-runner.js';
import { getSandboxProviderAdapter } from './providers/index.js';

const defaultDockerConfig: DockerConfig = {
  imageName: 'larkup-sandbox:latest',
  memoryMB: 512,
  cpuShares: 1024,
  timeoutMs: 30_000,
  networkDisabled: true,
};

export class SandboxManager {
  private config: SandboxConfig;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      backend: config?.backend ?? 'local',
      docker: config?.docker,
      credentials: config?.credentials,
    };
  }

  /** Check if the sandbox backend is available and ready. */
  async healthCheck(): Promise<SandboxHealthCheck> {
    if (this.config.backend === 'local') return checkLocalRuntime();
    if (this.config.backend === 'docker') return checkDockerHealth();

    const adapter = getSandboxProviderAdapter(this.config.backend);
    if (!adapter) {
      return {
        status: 'error',
        backend: this.config.backend,
        error: `Unknown or unsupported backend: ${this.config.backend}`,
      };
    }
    return adapter.healthCheck(this.config.credentials ?? {});
  }

  /** Set up the sandbox backend (e.g., build Docker image). */
  async setup(onProgress?: (msg: string) => void): Promise<void> {
    switch (this.config.backend) {
      case 'local':
        return;
      case 'docker':
        await buildSandboxImage(onProgress);
        break;

      default:
        throw new Error(`Setup not supported for backend: ${this.config.backend}`);
    }
  }

  /** Execute code in the sandbox. */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (this.config.backend === 'local') return executeLocally(request);
    if (this.config.backend === 'docker') {
      const health = await checkDockerHealth();
      if (health.status === 'docker-not-found' || health.status === 'error') {
        return {
          stdout: '',
          stderr:
            'Local code execution is unavailable because Docker is not running. Start Docker, choose a configured remote sandbox provider, or continue without code execution.',
          exitCode: 1,
          artifacts: [],
          executionTimeMs: 0,
        };
      }

      const imageReady = health.imageReady || (await ensureImage().catch(() => false));
      if (!imageReady) {
        return {
          stdout: '',
          stderr:
            'Local code execution is not ready. Build the Larkup sandbox image, choose a configured remote sandbox provider, or continue without code execution.',
          exitCode: 1,
          artifacts: [],
          executionTimeMs: 0,
        };
      }

      const dockerConfig: DockerConfig = {
        ...defaultDockerConfig,
        ...this.config.docker,
      };

      return executeInDocker(request, dockerConfig);
    }

    const adapter = getSandboxProviderAdapter(this.config.backend);
    if (!adapter) {
      return {
        stdout: '',
        stderr: `Unknown or unsupported backend: ${this.config.backend}`,
        exitCode: 1,
        artifacts: [],
        executionTimeMs: 0,
      };
    }
    return adapter.execute(request, this.config.credentials ?? {});
  }
}

/** Verifies a remote provider's credentials — powers the Settings "Verify" button. */
export async function verifySandboxProvider(
  backend: SandboxConfig['backend'],
  credentials: Record<string, string>,
): Promise<void> {
  if (backend === 'local') {
    const health = await checkLocalRuntime();
    if (health.status !== 'ready')
      throw new Error(health.error ?? 'Local runtime is not available.');
    return;
  }
  if (backend === 'docker') {
    const health = await checkDockerHealth();
    if (health.status !== 'ready') throw new Error(health.error ?? 'Docker is not available.');
    return;
  }
  const adapter = getSandboxProviderAdapter(backend);
  if (!adapter) throw new Error(`Unknown or unsupported backend: ${backend}`);
  await adapter.verifyCredentials(credentials);
}
