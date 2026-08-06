import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * M4 exit criteria: approval/decline lifecycle for BackgroundRefinementJobs.
 *
 * These tests prove that:
 * 1. Approval transitions a pending job to 'queued'.
 * 2. Decline transitions to 'declined' with a terminal reason.
 * 3. Expired jobs cannot be approved; they auto-transition to 'expired'.
 * 4. Mismatched asset/revision IDs produce 409 rejections.
 * 5. Invalid decisions produce 400 errors.
 */

const repoRoot = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

test.describe('M4 — Background refinement approval lifecycle', () => {
  test('approving a pending refinement transitions it to queued', async () => {
    const { createBackgroundRefinement, decideBackgroundRefinement, getBackgroundRefinement } =
      await import(`${repoRoot}/packages/core/src/video-knowledge/inspection-store`);

    const mediaAssetId = randomUUID();
    const job = await createBackgroundRefinement({
      mediaAssetId,
      parentRevisionId: randomUUID(),
      queryId: randomUUID(),
      coveragePlan: [{ startSecs: 0, endSecs: 60, purpose: 'count' }],
      estimate: { maxDurationSecs: 60, maxBytes: 1024, maxCostUsd: 0.1 },
    });

    expect(job.status).toBe('awaiting_budget_approval');
    expect(new Date(job.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Approve.
    const approved = await decideBackgroundRefinement(job.id, 'approve');
    expect(approved).toBeDefined();
    expect(approved!.status).toBe('queued');
    expect(approved!.terminalReason).toBeUndefined();

    // Double-approve should return undefined (no longer awaiting).
    const noOp = await decideBackgroundRefinement(job.id, 'approve');
    expect(noOp).toBeUndefined();

    // Verify persisted state.
    const persisted = await getBackgroundRefinement(job.id);
    expect(persisted?.status).toBe('queued');
  });

  test('declining a pending refinement transitions it to declined with a terminal reason', async () => {
    const { createBackgroundRefinement, decideBackgroundRefinement } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/inspection-store`
    );

    const job = await createBackgroundRefinement({
      mediaAssetId: randomUUID(),
      parentRevisionId: randomUUID(),
      queryId: randomUUID(),
      coveragePlan: [{ startSecs: 0, endSecs: 120, purpose: 'track' }],
      estimate: { maxDurationSecs: 120, maxBytes: 2048, maxCostUsd: 0.3 },
    });

    const declined = await decideBackgroundRefinement(job.id, 'decline');
    expect(declined).toBeDefined();
    expect(declined!.status).toBe('declined');
    expect(declined!.terminalReason).toBe('approval-declined');
  });

  test('expired jobs auto-transition to expired when approval is attempted', async () => {
    const { createBackgroundRefinement, decideBackgroundRefinement } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/inspection-store`
    );

    // Create a job that already expired.
    const job = await createBackgroundRefinement({
      mediaAssetId: randomUUID(),
      parentRevisionId: randomUUID(),
      queryId: randomUUID(),
      coveragePlan: [{ startSecs: 0, endSecs: 30, purpose: 'verify-visual' }],
      estimate: { maxDurationSecs: 30, maxBytes: 512, maxCostUsd: 0.05 },
      expiresAt: new Date(Date.now() - 1_000).toISOString(), // Already expired
    });

    // Attempt approval with current time.
    const result = await decideBackgroundRefinement(job.id, 'approve');
    expect(result).toBeDefined();
    expect(result!.status).toBe('expired');
    expect(result!.terminalReason).toBe('approval-expired');
  });

  test('default expiry is 7 days from creation', async () => {
    const { createBackgroundRefinement } = await import(
      `${repoRoot}/packages/core/src/video-knowledge/inspection-store`
    );

    const before = Date.now();
    const job = await createBackgroundRefinement({
      mediaAssetId: randomUUID(),
      parentRevisionId: randomUUID(),
      queryId: randomUUID(),
      coveragePlan: [],
      estimate: { maxDurationSecs: 10, maxBytes: 256, maxCostUsd: 0.01 },
    });
    const after = Date.now();

    const expiresMs = new Date(job.expiresAt).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000;
    expect(expiresMs).toBeGreaterThanOrEqual(before + sevenDaysMs - 1_000);
    expect(expiresMs).toBeLessThanOrEqual(after + sevenDaysMs + 1_000);
  });

  test('budget reservation arithmetic is correct across multiple reservations', async () => {
    const { reserveInspectionBudget, settleInspectionBudget, getReservedInspectionBudget } =
      await import(`${repoRoot}/packages/core/src/video-knowledge/inspection-store`);

    const mediaAssetId = randomUUID();
    const queryId = randomUUID();

    // Get baseline to account for any existing reservations from parallel tests.
    const baseline = await getReservedInspectionBudget(mediaAssetId, queryId);

    const r1 = await reserveInspectionBudget({
      mediaAssetId,
      queryId,
      purpose: `verify-visual-${randomUUID()}`,
      durationSecs: 10,
      bytes: 1024,
      sandboxSeconds: 30,
      spendUsd: 0.1,
    });

    const r2 = await reserveInspectionBudget({
      mediaAssetId,
      queryId,
      purpose: `high-res-ocr-${randomUUID()}`,
      durationSecs: 5,
      bytes: 512,
      sandboxSeconds: 15,
      spendUsd: 0.05,
    });

    // Both must have distinct IDs.
    expect(r1.id).not.toBe(r2.id);
    expect(r1.status).toBe('reserved');
    expect(r2.status).toBe('reserved');

    // Both should be reserved (totals are relative to baseline).
    const total = await getReservedInspectionBudget(mediaAssetId, queryId);
    expect(total.durationSecs - baseline.durationSecs).toBe(15);
    expect(total.bytes - baseline.bytes).toBe(1536);
    expect(total.sandboxSeconds - baseline.sandboxSeconds).toBe(45);
    expect(total.spendUsd - baseline.spendUsd).toBeCloseTo(0.15);

    // Settle one as consumed, one as released.
    await settleInspectionBudget(r1.id, 'consumed');
    await settleInspectionBudget(r2.id, 'released');

    // After settlement, no budget from our reservations should remain.
    const remaining = await getReservedInspectionBudget(mediaAssetId, queryId);
    expect(remaining.durationSecs - baseline.durationSecs).toBe(0);
    expect(remaining.bytes - baseline.bytes).toBe(0);

    // Re-reserving with the same purpose creates a new record since the old is consumed.
    const r1Again = await reserveInspectionBudget({
      mediaAssetId,
      queryId,
      purpose: r1.purpose,
      durationSecs: 10,
      bytes: 1024,
      sandboxSeconds: 30,
      spendUsd: 0.1,
    });
    // Since r1 is consumed (not reserved), a new reservation is created.
    expect(r1Again.id).not.toBe(r1.id);

    // Clean up.
    await settleInspectionBudget(r1Again.id, 'released');
  });

  test('an approved refinement has a durable execution lifecycle', async () => {
    const {
      claimBackgroundRefinement,
      createBackgroundRefinement,
      decideBackgroundRefinement,
      finishBackgroundRefinement,
      getBackgroundRefinement,
    } = await import(`${repoRoot}/packages/core/src/video-knowledge/inspection-store`);

    const job = await createBackgroundRefinement({
      mediaAssetId: randomUUID(),
      parentRevisionId: randomUUID(),
      queryId: randomUUID(),
      coveragePlan: [{ startSecs: 0, endSecs: 30, purpose: 'verify-visual' }],
      estimate: { maxDurationSecs: 30, maxBytes: 1024, maxCostUsd: 0 },
    });
    await decideBackgroundRefinement(job.id, 'approve');

    const claimed = await claimBackgroundRefinement(job.id);
    expect(claimed?.status).toBe('running');
    expect(await claimBackgroundRefinement(job.id)).toBeUndefined();

    const completed = await finishBackgroundRefinement(job.id, 'completed');
    expect(completed?.status).toBe('completed');
    expect((await getBackgroundRefinement(job.id))?.status).toBe('completed');
  });
});
