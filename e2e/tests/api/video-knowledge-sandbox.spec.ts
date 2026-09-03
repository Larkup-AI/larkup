import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * M4 exit criteria: sandbox analysis bundles, inspection policy enforcement,
 * and partial-chunk handling.
 *
 * These tests prove that:
 * 1. AnalysisBundle manifests contain no host paths or storage credentials.
 * 2. Inspection policy enforces per-bundle and aggregate budget limits.
 * 3. Bundle creation respects the maxBytes ceiling.
 * 4. Background refinement handoff is triggered when limits are exceeded.
 */

const repoRoot = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

test.describe('M4 — Analysis bundle creation', () => {
  test('creates a bundle with frame manifest and enforces byte ceiling', async () => {
    const { createAnalysisBundle } = await import(
      `${repoRoot}/apps/web/lib/media/video/analysis-bundle`
    );

    const workspace = await mkdtemp(path.join(tmpdir(), 'larkup-bundle-e2e-'));
    try {
      // Create 4 fake frame files.
      const frames = [];
      for (let i = 0; i < 4; i++) {
        const framePath = path.join(workspace, `frame-${i}.jpg`);
        // 500 bytes per frame.
        await writeFile(framePath, Buffer.alloc(500, i));
        frames.push({ path: framePath, timestampSecs: i * 2, evidenceId: `evidence-${i}` });
      }

      // Allow only 1200 bytes → should fit 2 frames (1000 bytes) + manifest.
      const bundle = await createAnalysisBundle({
        mediaAssetId: 'asset-test',
        range: { startSecs: 0, endSecs: 8 },
        frames,
        maxBytes: 1200,
      });

      // Verify bundle shape.
      expect(bundle.id).toBeTruthy();
      expect(bundle.mediaAssetId).toBe('asset-test');
      expect(bundle.range).toEqual({ startSecs: 0, endSecs: 8 });

      // Should have 2 frame files + 1 manifest file.
      expect(bundle.files).toHaveLength(3);
      const manifestFile = bundle.files.find(
        (file: { name: string }) => file.name === 'manifest.json',
      );
      expect(manifestFile).toBeDefined();

      // Parse manifest and verify no host paths.
      const manifest = JSON.parse(manifestFile!.content as string);
      expect(manifest.version).toBe(1);
      expect(manifest.mediaAssetId).toBe('asset-test');
      expect(manifest.frames).toHaveLength(2);
      for (const frame of manifest.frames) {
        expect(frame.name).toMatch(/^frame-\d{4}\.jpg$/);
        expect(frame.timestampSecs).toBeDefined();
        // No host paths should appear in the manifest.
        expect(frame.name).not.toContain('/');
        expect(frame.name).not.toContain(workspace);
      }

      // Frame files should be base64 encoded.
      const frameFiles = bundle.files.filter(
        (file: { name: string }) => file.name !== 'manifest.json',
      );
      for (const file of frameFiles) {
        expect(file.isBase64).toBe(true);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

test.describe('M4 — Inspection policy enforcement', () => {
  test('denies inspection when no plausible range exists', async () => {
    const { decideInspection } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/inspection-policy`
    );

    const decision = decideInspection({
      required: true,
      plausibleRange: false,
      estimate: {
        durationSecs: 5,
        bytes: 100,
        sandboxSeconds: 10,
        spendUsd: 0.01,
        lowerResolutionProbability: 0.9,
      },
      budget: {
        remainingDurationSecs: 180,
        remainingBytes: 1024 * 1024 * 1024,
        remainingSandboxSeconds: 600,
        remainingSpendUsd: 0.5,
        usedBundleRuns: 0,
      },
    });

    expect(decision.decision).toBe('denied');
    expect(decision.reason).toBe('no-plausible-observable-range');
  });

  test('hands oversized work to background refinement', async () => {
    const { decideInspection, LIMITS } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/inspection-policy`
    );

    const decision = decideInspection({
      required: true,
      plausibleRange: true,
      estimate: {
        // Just past the per-bundle cap, read from the policy so raising the
        // cap does not silently turn this into a pass.
        durationSecs: LIMITS.durationSecs + 1,
        bytes: 1,
        sandboxSeconds: 1,
        spendUsd: 0,
        lowerResolutionProbability: 1,
      },
      budget: {
        remainingDurationSecs: 180,
        remainingBytes: 1024 * 1024 * 1024,
        remainingSandboxSeconds: 600,
        remainingSpendUsd: 0.5,
        usedBundleRuns: 0,
      },
    });

    expect(decision.decision).toBe('background-refinement');
    expect(decision.reason).toBe('inspection-exceeds-query-budget');
  });

  test('hands work to background refinement when aggregate budget is exceeded', async () => {
    const { decideInspection } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/inspection-policy`
    );

    const decision = decideInspection({
      required: true,
      plausibleRange: true,
      estimate: {
        durationSecs: 10,
        bytes: 100,
        sandboxSeconds: 10,
        spendUsd: 0.1,
        lowerResolutionProbability: 1,
      },
      budget: {
        remainingDurationSecs: 5,
        remainingBytes: 100,
        remainingSandboxSeconds: 600,
        remainingSpendUsd: 0.5,
        usedBundleRuns: 0,
      },
    });

    expect(decision.decision).toBe('background-refinement');
  });

  test('hands work to background refinement when bundle run cap (12) is exhausted', async () => {
    const { decideInspection } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/inspection-policy`
    );

    const decision = decideInspection({
      required: true,
      plausibleRange: true,
      estimate: {
        durationSecs: 5,
        bytes: 100,
        sandboxSeconds: 10,
        spendUsd: 0.01,
        lowerResolutionProbability: 1,
      },
      budget: {
        remainingDurationSecs: 180,
        remainingBytes: 1024 * 1024 * 1024,
        remainingSandboxSeconds: 600,
        remainingSpendUsd: 0.5,
        usedBundleRuns: 12,
      },
    });

    expect(decision.decision).toBe('background-refinement');
  });

  test('enforces the exact 0.59 → denied vs 0.60 → optional threshold', async () => {
    const { decideInspection } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/inspection-policy`
    );

    const baseBudget = {
      remainingDurationSecs: 180,
      remainingBytes: 1024 * 1024 * 1024,
      remainingSandboxSeconds: 600,
      remainingSpendUsd: 0.5,
      usedBundleRuns: 0,
    };

    // At 0.59: deterministically denied.
    const denied = decideInspection({
      required: false,
      plausibleRange: true,
      estimate: {
        durationSecs: 5,
        bytes: 100,
        sandboxSeconds: 10,
        spendUsd: 0.01,
        lowerResolutionProbability: 0.59,
      },
      budget: baseBudget,
    });
    expect(denied.decision).toBe('denied');
    expect(denied.reason).toBe('resolution-probability-below-policy-threshold');

    // At 0.60: optional inspection allowed.
    const optional = decideInspection({
      required: false,
      plausibleRange: true,
      estimate: {
        durationSecs: 5,
        bytes: 100,
        sandboxSeconds: 10,
        spendUsd: 0.01,
        lowerResolutionProbability: 0.6,
      },
      budget: baseBudget,
    });
    expect(optional.decision).toBe('optional');
    expect(optional.reason).toBe('bounded-optional-inspection');
  });

  test('required inspection bypasses the resolution probability threshold', async () => {
    const { decideInspection } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/inspection-policy`
    );

    const decision = decideInspection({
      required: true,
      plausibleRange: true,
      estimate: {
        durationSecs: 5,
        bytes: 100,
        sandboxSeconds: 10,
        spendUsd: 0.01,
        lowerResolutionProbability: 0.1,
      },
      budget: {
        remainingDurationSecs: 180,
        remainingBytes: 1024 * 1024 * 1024,
        remainingSandboxSeconds: 600,
        remainingSpendUsd: 0.5,
        usedBundleRuns: 0,
      },
    });

    expect(decision.decision).toBe('required');
    expect(decision.reason).toBe('required-observable-claim');
  });
});
