export type SandboxBackend =
  | 'local'
  | 'docker'
  | 'e2b'
  | 'vercel'
  | 'modal'
  | 'daytona'
  | 'browserbase'
  | 'flyio'
  | 'northflank'
  | 'cloudflare'
  | 'webcontainers'
  | 'custom';

export interface DockerConfig {
  /** Docker image to use (default: "larkup-sandbox:latest") */
  imageName: string;
  /** Memory limit in MB (default: 512) */
  memoryMB: number;
  /** CPU shares (default: 1024 = 1 core) */
  cpuShares: number;
  /** Max execution time in ms (default: 30000) */
  timeoutMs: number;
  /** Disable network access in the container (default: true) */
  networkDisabled: boolean;
}

export interface SandboxConfig {
  backend: SandboxBackend;
  docker?: Partial<DockerConfig>;
  /**
   * Credentials for the selected remote provider, keyed by the field `key`s
   * declared in that provider's `SandboxProviderDescriptor` (see registry.ts).
   * Unused by local and Docker backends.
   */
  credentials?: Record<string, string>;
}

export const DEFAULT_DOCKER_CONFIG: DockerConfig = {
  imageName: 'larkup-sandbox:latest',
  memoryMB: 512,
  cpuShares: 1024,
  timeoutMs: 30_000,
  networkDisabled: true,
};

export type SandboxLanguage = 'python' | 'javascript' | 'typescript';

export interface SandboxFile {
  /** Filename inside the sandbox (e.g., "data.csv") */
  name: string;
  /** File content as a string (text) or base64 (binary) */
  content: string;
  /** Whether content is base64-encoded (default: false) */
  isBase64?: boolean;
}

export interface ExecutionRequest {
  /** Code to execute */
  code: string;
  /** Programming language */
  language: SandboxLanguage;
  /** Files to mount into the sandbox working directory */
  files?: SandboxFile[];
  /** Max execution time in ms (overrides config default) */
  timeout?: number;
}

export interface ExecutionArtifact {
  /** Filename of the generated artifact */
  name: string;
  /** MIME type (e.g., "image/png", "text/csv") */
  mimeType: string;
  /** Content as base64-encoded string */
  data: string;
}

export interface ExecutionResult {
  /** Standard output from the execution */
  stdout: string;
  /** Standard error output */
  stderr: string;
  /** Process exit code (0 = success) */
  exitCode: number;
  /** Generated files (charts, CSVs, etc.) */
  artifacts: ExecutionArtifact[];
  /** Wall-clock execution time in ms */
  executionTimeMs: number;
}

export type SandboxStatus =
  | 'ready'
  | 'docker-not-found'
  | 'image-not-found'
  | 'building-image'
  | 'missing-credentials'
  | 'unsupported'
  | 'error';

export interface SandboxHealthCheck {
  status: SandboxStatus;
  backend: SandboxBackend;
  dockerVersion?: string;
  imageReady?: boolean;
  error?: string;
}

export type SandboxFieldType = 'text' | 'password';

/** A single credential/config field a sandbox provider needs. The Settings
 * UI renders these dynamically per provider, the same way vector store and
 * embedding provider fields are rendered from their own registries. */
export interface SandboxCredentialField {
  key: string;
  label: string;
  type: SandboxFieldType;
  required: boolean;
  placeholder?: string;
  help?: string;
  secret?: boolean;
}

export interface SandboxProviderDescriptor {
  id: SandboxBackend;
  label: string;
  description: string;
  /** npm package this adapter dynamically imports at runtime. Never a hard
   * dependency of @larkup/sandbox — installing all nine SDKs unconditionally
   * would bloat every consumer, so each adapter lazy-imports its own. */
  sdkPackage?: string;
  docsUrl: string;
  /** Path under /public/icons (or /public) in the web app. */
  icon: string;
  /**
   * Whether `execute()` genuinely runs arbitrary code/commands and returns
   * output, or the provider is architecturally something else (browser
   * automation, a client-only runtime, a Worker binding). Surfaced in the
   * UI so operators don't pick a provider that can't do what they expect.
   */
  executionSupport: 'full' | 'unsupported';
  /** Shown in the UI when executionSupport !== "full". */
  executionCaveat?: string;
  fields: SandboxCredentialField[];
}

/**
 * Adapter contract every remote sandbox backend implements. Docker is
 * handled separately (docker-runner.ts) since it talks to the local daemon
 * and needs no credentials.
 */
export interface SandboxProviderAdapter {
  readonly id: SandboxBackend;
  /** Cheap call that proves the credentials are valid — powers the "Verify" button. */
  verifyCredentials(credentials: Record<string, string>): Promise<void>;
  /** Confirms the backend is reachable/configured without spinning up a full sandbox. */
  healthCheck(credentials: Record<string, string>): Promise<SandboxHealthCheck>;
  /** Runs code/commands inside a fresh sandbox instance and tears it down afterward. */
  execute(request: ExecutionRequest, credentials: Record<string, string>): Promise<ExecutionResult>;
}
