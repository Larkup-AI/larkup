import { describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_PROFILES,
  admitTool,
  selectEnvironment,
  type ToolExecutionRequirements,
} from './execution';

const ffmpegTool: ToolExecutionRequirements = {
  toolId: 'video-audio',
  trustLevel: 'elevated',
  requiresExec: true,
  requiresPersistentStorage: true,
};

const searchTool: ToolExecutionRequirements = {
  toolId: 'web-search',
  trustLevel: 'standard',
  requiresNetwork: true,
};

describe('admitTool', () => {
  it('admits a standard tool on a serverless target', () => {
    const decision = admitTool(ENVIRONMENT_PROFILES.vercel, searchTool);
    expect(decision).toMatchObject({ admitted: true, reason: 'admitted' });
  });

  it('refuses a tool whose trust level exceeds the environment cap', () => {
    const decision = admitTool(ENVIRONMENT_PROFILES['cloud-run'], ffmpegTool);
    expect(decision.admitted).toBe(false);
    expect(decision.reason).toBe('trust-exceeded');
    // The operator has to be able to act on this without reading the source.
    expect(decision.detail).toContain('elevated');
    expect(decision.detail).toContain('standard');
  });

  it('names capability as the blocker when trust alone would have passed', () => {
    // privileged trust is granted, but the target still cannot fork.
    const decision = admitTool(
      { ...ENVIRONMENT_PROFILES.vercel, maxTrustLevel: 'privileged' },
      { toolId: 'shell', trustLevel: 'standard', requiresExec: true },
    );
    expect(decision.reason).toBe('requires-exec');
    expect(decision.detail).toMatch(/worker|Docker/i);
  });

  it('refuses a writing tool on an ephemeral target', () => {
    const decision = admitTool(ENVIRONMENT_PROFILES['cloud-run'], {
      toolId: 'report-writer',
      trustLevel: 'standard',
      requiresPersistentStorage: true,
    });
    expect(decision.reason).toBe('requires-persistent-storage');
  });

  it('refuses a networked tool where egress is disabled', () => {
    const airGapped = {
      ...ENVIRONMENT_PROFILES.docker,
      limits: { ...ENVIRONMENT_PROFILES.docker.limits, networkEgress: 'none' as const },
    };
    expect(admitTool(airGapped, searchTool).reason).toBe('requires-network');
  });

  it('admits the media tool on the worker profile it was sized for', () => {
    const decision = admitTool(ENVIRONMENT_PROFILES.worker, ffmpegTool);
    expect(decision.admitted).toBe(true);
  });

  it('always reports both the required and the granted trust level', () => {
    const decision = admitTool(ENVIRONMENT_PROFILES.vercel, ffmpegTool);
    expect(decision.requiredTrustLevel).toBe('elevated');
    expect(decision.grantedTrustLevel).toBe('standard');
    expect(decision.target).toBe('vercel');
  });
});

describe('environment profiles', () => {
  it('gives every target explicit resource limits', () => {
    for (const [target, profile] of Object.entries(ENVIRONMENT_PROFILES)) {
      expect(profile.limits, target).toBeDefined();
      expect(profile.limits.maxDurationMs, target).toBeGreaterThan(0);
      expect(profile.limits.memoryMb, target).toBeGreaterThan(0);
    }
  });

  it('never grants more than standard trust on an ephemeral target', () => {
    expect(ENVIRONMENT_PROFILES.vercel.maxTrustLevel).toBe('standard');
    expect(ENVIRONMENT_PROFILES['cloud-run'].maxTrustLevel).toBe('standard');
    expect(ENVIRONMENT_PROFILES.vercel.hasPersistentStorage).toBe(false);
    expect(ENVIRONMENT_PROFILES['cloud-run'].hasPersistentStorage).toBe(false);
  });

  it('restricts egress everywhere the code is not first-party trusted', () => {
    expect(ENVIRONMENT_PROFILES.sandbox.limits.networkEgress).toBe('allowlist');
    expect(ENVIRONMENT_PROFILES.vercel.limits.networkEgress).toBe('allowlist');
  });

  it('gives the worker profile the headroom media work needs', () => {
    const worker = ENVIRONMENT_PROFILES.worker.limits;
    expect(worker.memoryMb).toBeGreaterThanOrEqual(8192);
    expect(worker.maxDurationMs).toBeGreaterThanOrEqual(30 * 60_000);
    expect(worker.scratchDiskMb).toBeGreaterThanOrEqual(16_384);
  });
});

describe('selectEnvironment', () => {
  it('keeps a compatible tool on the agent’s own target', () => {
    expect(selectEnvironment('cloud-run', searchTool).target).toBe('cloud-run');
  });

  it('routes an incompatible tool to a worker when one is available', () => {
    const environment = selectEnvironment('cloud-run', ffmpegTool, { workerAvailable: true });
    expect(environment.target).toBe('worker');
    expect(admitTool(environment, ffmpegTool).admitted).toBe(true);
  });

  it('does not invent a worker that the deployment does not have', () => {
    const environment = selectEnvironment('cloud-run', ffmpegTool);
    expect(environment.target).toBe('cloud-run');
    // And the caller then gets an explicit refusal rather than a silent skip.
    expect(admitTool(environment, ffmpegTool).admitted).toBe(false);
  });
});
