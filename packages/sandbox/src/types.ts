export type SandboxBackend = "docker" | "e2b" | "modal" | "custom";

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

export interface RemoteConfig {
  provider: "e2b" | "modal" | "custom";
  apiKey: string;
  endpoint?: string;
}

export interface SandboxConfig {
  backend: SandboxBackend;
  docker?: Partial<DockerConfig>;
  remote?: RemoteConfig;
}

export const DEFAULT_DOCKER_CONFIG: DockerConfig = {
  imageName: "larkup-sandbox:latest",
  memoryMB: 512,
  cpuShares: 1024,
  timeoutMs: 30_000,
  networkDisabled: true,
};

/* ------------------------------------------------------------------ */
/* Execution request / result                                          */
/* ------------------------------------------------------------------ */

export type SandboxLanguage = "python" | "javascript" | "typescript";

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

/* ------------------------------------------------------------------ */
/* Sandbox status                                                      */
/* ------------------------------------------------------------------ */

export type SandboxStatus =
  | "ready"
  | "docker-not-found"
  | "image-not-found"
  | "building-image"
  | "error";

export interface SandboxHealthCheck {
  status: SandboxStatus;
  backend: SandboxBackend;
  dockerVersion?: string;
  imageReady?: boolean;
  error?: string;
}
