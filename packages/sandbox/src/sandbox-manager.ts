/**
 * Sandbox manager — high-level API for code execution.
 *
 * Provides a unified interface that routes to the appropriate backend
 * (Docker, E2B, etc.) based on configuration. Handles health checks,
 * image setup, and execution lifecycle.
 */

import type {
  SandboxConfig,
  ExecutionRequest,
  ExecutionResult,
  SandboxHealthCheck,
  DockerConfig,
  DEFAULT_DOCKER_CONFIG,
} from "./types"
import {
  checkDockerHealth,
  buildSandboxImage,
  ensureImage,
  executeInDocker,
} from "./docker-runner"

const defaultDockerConfig: DockerConfig = {
  imageName: "larkup-sandbox:latest",
  memoryMB: 512,
  cpuShares: 1024,
  timeoutMs: 30_000,
  networkDisabled: true,
}

export class SandboxManager {
  private config: SandboxConfig

  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      backend: config?.backend ?? "docker",
      docker: config?.docker,
      remote: config?.remote,
    }
  }

  /** Check if the sandbox backend is available and ready. */
  async healthCheck(): Promise<SandboxHealthCheck> {
    switch (this.config.backend) {
      case "docker":
        return checkDockerHealth()

      case "e2b":
      case "modal":
      case "custom":
        return {
          status: "error",
          backend: this.config.backend,
          error: `${this.config.backend} backend is not yet implemented. Use Docker for local execution.`,
        }

      default:
        return {
          status: "error",
          backend: this.config.backend,
          error: `Unknown backend: ${this.config.backend}`,
        }
    }
  }

  /** Set up the sandbox backend (e.g., build Docker image). */
  async setup(onProgress?: (msg: string) => void): Promise<void> {
    switch (this.config.backend) {
      case "docker":
        await buildSandboxImage(onProgress)
        break

      default:
        throw new Error(`Setup not supported for backend: ${this.config.backend}`)
    }
  }

  /** Execute code in the sandbox. */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    switch (this.config.backend) {
      case "docker": {
        // Ensure image is available
        const imageReady = await ensureImage()
        if (!imageReady) {
          return {
            stdout: "",
            stderr:
              "Sandbox image not available. Run setup first or ensure Docker is installed.",
            exitCode: 1,
            artifacts: [],
            executionTimeMs: 0,
          }
        }

        const dockerConfig: DockerConfig = {
          ...defaultDockerConfig,
          ...this.config.docker,
        }

        return executeInDocker(request, dockerConfig)
      }

      case "e2b":
      case "modal":
      case "custom":
        return {
          stdout: "",
          stderr: `${this.config.backend} backend is not yet implemented.`,
          exitCode: 1,
          artifacts: [],
          executionTimeMs: 0,
        }

      default:
        return {
          stdout: "",
          stderr: `Unknown backend: ${this.config.backend}`,
          exitCode: 1,
          artifacts: [],
          executionTimeMs: 0,
        }
    }
  }
}
