/**
 * @larkup/sandbox — Main entry point.
 *
 * Re-exports the public API for the sandbox package.
 */

export { SandboxManager, verifySandboxProvider } from './sandbox-manager.js';
export {
  checkDockerHealth,
  buildSandboxImage,
  ensureImage,
  executeInDocker,
} from './docker-runner.js';
export { checkLocalRuntime, executeLocally } from './local-runner.js';
export {
  SANDBOX_PROVIDERS,
  SANDBOX_PROVIDER_LIST,
  getSandboxProvider,
  validateSandboxCredentials,
} from './registry.js';
export type {
  SandboxBackend,
  SandboxConfig,
  DockerConfig,
  SandboxLanguage,
  SandboxFile,
  ExecutionRequest,
  ExecutionResult,
  ExecutionArtifact,
  SandboxStatus,
  SandboxHealthCheck,
  SandboxCredentialField,
  SandboxProviderDescriptor,
  SandboxProviderAdapter,
} from './types.js';
