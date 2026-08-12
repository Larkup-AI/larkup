/**
 * @larkup/agent-contracts — Execution environment contract.
 *
 * Describes where and how an Agent or tool runs. Plan §6: execution must be
 * *selected* per tool and release, never accidentally implied by a UI setting,
 * and the contract must stay provider-neutral so E2B, Vercel Sandbox, Modal, or
 * a plain worker container are replaceable adapters rather than a dependency.
 *
 * Two things this file exists to prevent:
 *
 * 1. A tool that needs to spawn `ffmpeg` being installed onto a serverless
 *    target where it silently cannot work.
 * 2. A permission escalation being swallowed. A refused tool produces a
 *    {@link ExecutionDecision} the runtime can log and the dashboard can show —
 *    "quietly skipped" is how an operator ends up debugging a wrong answer.
 *
 * Schema version: 2.1
 */

import { readFileSync } from 'node:fs';
import type { ToolTrustLevel } from './agent';
import { isTrustSufficient } from './tool';

// Re-exported so `@larkup/agent-contracts/execution` is usable on its own.
export { isTrustSufficient };

/* ------------------------------------------------------------------ */
/* Execution targets                                                   */
/* ------------------------------------------------------------------ */

/**
 * Deployment targets (per ADR-007 portability requirement).
 *
 * - `local`      — Developer machine (CLI, Desktop, or `pnpm run dev`)
 * - `docker`     — VPS / self-hosted Docker Compose container
 * - `worker`     — Dedicated container for media, ffmpeg, long-running work
 * - `cloud-run`  — Google Cloud Run (scales to zero)
 * - `vercel`     — Vercel serverless functions (ephemeral, no local storage)
 * - `sandbox`    — Remote ephemeral sandbox (E2B / Modal / Vercel Sandbox)
 */
export type ExecutionTarget = 'local' | 'docker' | 'worker' | 'cloud-run' | 'vercel' | 'sandbox';

/**
 * Resource ceilings for one invocation (plan §6).
 *
 * Provider-neutral on purpose: every runner can express these, and a tool
 * author reasons about them without knowing which one they will get.
 */
export interface ExecutionLimits {
  /** Fractional CPU cores available to one invocation. */
  cpuCores: number;
  /** Memory ceiling in MiB. */
  memoryMb: number;
  /** Wall-clock ceiling for a single invocation, in milliseconds. */
  maxDurationMs: number;
  /** Writable scratch space in MiB. 0 means no writable filesystem. */
  scratchDiskMb: number;
  /**
   * Outbound network policy.
   * - `none`      — no egress at all
   * - `allowlist` — only hosts a tool declares in its manifest
   * - `full`      — unrestricted (trusted first-party only)
   */
  networkEgress: 'none' | 'allowlist' | 'full';
  /** Maximum bytes of artifacts one invocation may return. */
  maxArtifactBytes: number;
  /** Maximum bytes of logs retained per invocation. */
  maxLogBytes: number;
}

/** Describes the environment an Agent or tool is running in. */
export interface ExecutionEnvironment {
  target: ExecutionTarget;
  /**
   * Maximum trust level tools are allowed to execute at in this environment.
   * - `vercel` & `cloud-run` cap at `standard` (no exec/fs-write)
   * - `sandbox` caps at `elevated`
   * - `local`, `docker` & `worker` allow `privileged` (user opted in)
   */
  maxTrustLevel: ToolTrustLevel;
  /** Whether the environment has a writable persistent filesystem */
  hasPersistentStorage: boolean;
  /** Whether npm packages can be installed at runtime */
  canInstallPackages: boolean;
  /** Whether the environment can spawn child processes */
  canExec: boolean;
  /** Resource ceilings applied to a single tool invocation. */
  limits: ExecutionLimits;
  /** Region hint for latency-aware routing (e.g. "us-central1") */
  region?: string;
  /** Node.js version string */
  nodeVersion?: string;
}

/* ------------------------------------------------------------------ */
/* Environment profiles (sane defaults per target)                    */
/* ------------------------------------------------------------------ */

const LIMITS: Record<ExecutionTarget, ExecutionLimits> = {
  local: {
    cpuCores: 2,
    memoryMb: 4096,
    maxDurationMs: 300_000,
    scratchDiskMb: 8192,
    networkEgress: 'full',
    maxArtifactBytes: 512 * 1024 * 1024,
    maxLogBytes: 1024 * 1024,
  },
  docker: {
    cpuCores: 2,
    memoryMb: 2048,
    maxDurationMs: 300_000,
    scratchDiskMb: 4096,
    networkEgress: 'full',
    maxArtifactBytes: 256 * 1024 * 1024,
    maxLogBytes: 1024 * 1024,
  },
  // Sized for the video/audio path: ffmpeg wants cores, memory, and time.
  worker: {
    cpuCores: 4,
    memoryMb: 8192,
    maxDurationMs: 30 * 60_000,
    scratchDiskMb: 32_768,
    networkEgress: 'full',
    maxArtifactBytes: 2 * 1024 * 1024 * 1024,
    maxLogBytes: 4 * 1024 * 1024,
  },
  'cloud-run': {
    cpuCores: 1,
    memoryMb: 1024,
    // Cloud Run's own request ceiling is 60 minutes, but an agent turn that
    // takes minutes is a broken agent; keep the tool budget short.
    maxDurationMs: 120_000,
    scratchDiskMb: 512, // in-memory tmpfs — counts against memoryMb
    networkEgress: 'allowlist',
    maxArtifactBytes: 32 * 1024 * 1024,
    maxLogBytes: 512 * 1024,
  },
  vercel: {
    cpuCores: 1,
    memoryMb: 1024,
    maxDurationMs: 60_000,
    scratchDiskMb: 512,
    networkEgress: 'allowlist',
    maxArtifactBytes: 4 * 1024 * 1024,
    maxLogBytes: 256 * 1024,
  },
  sandbox: {
    cpuCores: 2,
    memoryMb: 2048,
    maxDurationMs: 300_000,
    scratchDiskMb: 4096,
    networkEgress: 'allowlist',
    maxArtifactBytes: 128 * 1024 * 1024,
    maxLogBytes: 1024 * 1024,
  },
};

export const ENVIRONMENT_PROFILES: Record<ExecutionTarget, ExecutionEnvironment> = {
  local: {
    target: 'local',
    maxTrustLevel: 'privileged',
    hasPersistentStorage: true,
    canInstallPackages: true,
    canExec: true,
    limits: LIMITS.local,
  },
  docker: {
    target: 'docker',
    maxTrustLevel: 'privileged',
    hasPersistentStorage: true, // via named volumes
    canInstallPackages: true,
    canExec: true,
    limits: LIMITS.docker,
  },
  worker: {
    target: 'worker',
    maxTrustLevel: 'privileged',
    hasPersistentStorage: true,
    canInstallPackages: true,
    canExec: true,
    limits: LIMITS.worker,
  },
  'cloud-run': {
    target: 'cloud-run',
    maxTrustLevel: 'standard',
    hasPersistentStorage: false, // ephemeral, use GCS / LanceDB Cloud
    canInstallPackages: false,
    canExec: false,
    limits: LIMITS['cloud-run'],
  },
  vercel: {
    target: 'vercel',
    maxTrustLevel: 'standard',
    hasPersistentStorage: false, // ephemeral — enforce durable storage (ADR-004)
    canInstallPackages: false,
    canExec: false,
    limits: LIMITS.vercel,
  },
  sandbox: {
    target: 'sandbox',
    maxTrustLevel: 'elevated',
    hasPersistentStorage: false,
    canInstallPackages: true,
    canExec: true,
    limits: LIMITS.sandbox,
  },
};

/**
 * Resolve the current execution environment from env vars.
 * Call at server startup; inject into every ToolExecutionContext.
 */
export function resolveExecutionEnvironment(): ExecutionEnvironment {
  // LARKUP_EXEC_TARGET takes priority (set by Larkup at deploy time)
  const target = (process.env.LARKUP_EXEC_TARGET ?? detectTarget()) as ExecutionTarget;
  const profile = ENVIRONMENT_PROFILES[target] ?? ENVIRONMENT_PROFILES.local;
  return {
    ...profile,
    region: process.env.LARKUP_REGION ?? undefined,
    nodeVersion: process.version,
  };
}

function detectTarget(): ExecutionTarget {
  if (process.env.VERCEL) return 'vercel';
  if (process.env.K_SERVICE || process.env.CLOUD_RUN_JOB) return 'cloud-run';
  if (process.env.LARKUP_WORKER) return 'worker';
  if (isInsideDocker()) return 'docker';
  return 'local';
}

function isInsideDocker(): boolean {
  try {
    return readFileSync('/proc/self/cgroup', 'utf8').includes('docker');
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Admission decisions                                                 */
/* ------------------------------------------------------------------ */

/**
 * Why a tool was admitted or refused.
 *
 * Returned rather than thrown so the runtime can record every decision — plan
 * §12 requires "tool invocation, permission decision" in the event model, and
 * §7 of TASK 07 requires a denied escalation to be *surfaced*, not swallowed.
 */
export interface ExecutionDecision {
  toolId: string;
  admitted: boolean;
  target: ExecutionTarget;
  requiredTrustLevel: ToolTrustLevel;
  grantedTrustLevel: ToolTrustLevel;
  reason:
    | 'admitted'
    | 'trust-exceeded'
    | 'requires-exec'
    | 'requires-persistent-storage'
    | 'requires-network';
  /** One sentence for the dashboard and the log. Contains no secrets. */
  detail: string;
}

/** What a tool needs in order to run, taken from its manifest. */
export interface ToolExecutionRequirements {
  toolId: string;
  trustLevel: ToolTrustLevel;
  /** Spawns a subprocess (ffmpeg, whisper, a shell). */
  requiresExec?: boolean;
  /** Needs a writable filesystem that survives the invocation. */
  requiresPersistentStorage?: boolean;
  /** Needs outbound network access. */
  requiresNetwork?: boolean;
}

/**
 * Decide whether a tool may run in this environment.
 *
 * Checks capability as well as trust: a `privileged` tool that shells out is
 * still unusable on a target that cannot fork, and telling the operator *that*
 * is more useful than a generic refusal.
 */
export function admitTool(
  environment: ExecutionEnvironment,
  requirements: ToolExecutionRequirements,
): ExecutionDecision {
  const base = {
    toolId: requirements.toolId,
    target: environment.target,
    requiredTrustLevel: requirements.trustLevel,
    grantedTrustLevel: environment.maxTrustLevel,
  };

  if (!isTrustSufficient(environment.maxTrustLevel, requirements.trustLevel)) {
    return {
      ...base,
      admitted: false,
      reason: 'trust-exceeded',
      detail: `"${requirements.toolId}" needs ${requirements.trustLevel} trust, but the ${environment.target} environment grants at most ${environment.maxTrustLevel}.`,
    };
  }

  if (requirements.requiresExec && !environment.canExec) {
    return {
      ...base,
      admitted: false,
      reason: 'requires-exec',
      detail: `"${requirements.toolId}" spawns a subprocess, which the ${environment.target} environment cannot do. Run it on a worker or Docker target.`,
    };
  }

  if (requirements.requiresPersistentStorage && !environment.hasPersistentStorage) {
    return {
      ...base,
      admitted: false,
      reason: 'requires-persistent-storage',
      detail: `"${requirements.toolId}" needs persistent storage, which the ${environment.target} environment does not provide. Configure remote storage or use a Docker/worker target.`,
    };
  }

  if (requirements.requiresNetwork && environment.limits.networkEgress === 'none') {
    return {
      ...base,
      admitted: false,
      reason: 'requires-network',
      detail: `"${requirements.toolId}" needs outbound network access, which is disabled in the ${environment.target} environment.`,
    };
  }

  return {
    ...base,
    admitted: true,
    reason: 'admitted',
    detail: `"${requirements.toolId}" admitted at ${requirements.trustLevel} trust on ${environment.target}.`,
  };
}

/**
 * The environment a tool should run in, given the agent's own target.
 *
 * Plan §6 recommends a dedicated worker for media work. A tool that shells out
 * or needs real memory is routed to `worker` when the deployment has one,
 * rather than being refused on a serverless agent target.
 */
export function selectEnvironment(
  agentTarget: ExecutionTarget,
  requirements: ToolExecutionRequirements,
  options: { workerAvailable?: boolean } = {},
): ExecutionEnvironment {
  const agentEnvironment = ENVIRONMENT_PROFILES[agentTarget] ?? ENVIRONMENT_PROFILES.local;

  const needsMore =
    (requirements.requiresExec && !agentEnvironment.canExec) ||
    !isTrustSufficient(agentEnvironment.maxTrustLevel, requirements.trustLevel);

  if (needsMore && options.workerAvailable) return ENVIRONMENT_PROFILES.worker;
  return agentEnvironment;
}
