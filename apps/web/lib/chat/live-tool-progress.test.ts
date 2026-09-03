import { describe, expect, it } from 'vitest';
import {
  isIndeterminateProgress,
  keepToolProgressMonotonic,
  PENDING_PROGRESS_CEILING,
  RUNNING_PROGRESS_CEILING,
  smoothLiveToolProgress,
  smoothPendingToolProgress,
} from './live-tool-progress';

describe('smoothLiveToolProgress', () => {
  it('keeps an analyzing bar moving between sparse cloud updates', () => {
    const activity = {
      phase: 'analyzing' as const,
      percent: 5,
      label: 'Video Intelligence',
      message: 'Perceiving',
      updatedAt: '2026-08-30T12:00:00.000Z',
    };
    expect(smoothLiveToolProgress(activity, Date.parse(activity.updatedAt))).toBe(5);
    expect(
      smoothLiveToolProgress(activity, Date.parse(activity.updatedAt) + 60_000),
    ).toBeGreaterThan(5);
    expect(smoothLiveToolProgress(activity, Date.parse(activity.updatedAt) + 60_000)).toBeLessThan(
      RUNNING_PROGRESS_CEILING,
    );
  });

  it('never fabricates completion before the worker reports it', () => {
    const activity = {
      phase: 'analyzing' as const,
      percent: 5,
      label: 'Video Intelligence',
      message: 'Perceiving',
      updatedAt: '2026-08-30T12:00:00.000Z',
    };
    expect(
      smoothLiveToolProgress(activity, Date.parse(activity.updatedAt) + 20 * 60_000),
    ).toBeLessThanOrEqual(RUNNING_PROGRESS_CEILING);
  });

  // The worker reports 100 when its own pass ends, but the chat turn still has
  // to validate, store, activate and re-query that evidence -- and may then run
  // another range. A full bar through all of that is what read as hung.
  it('does not show a completed bar while the tool call is still running', () => {
    const finished = {
      phase: 'analyzing' as const,
      percent: 100,
      label: 'Video Intelligence',
      message: 'Composing',
      updatedAt: '2026-08-30T12:00:00.000Z',
    };
    expect(smoothLiveToolProgress(finished, Date.now())).toBe(RUNNING_PROGRESS_CEILING);
    expect(keepToolProgressMonotonic(100, 100)).toBe(RUNNING_PROGRESS_CEILING);
  });

  it('does not rewind when the same chat call begins its next bounded range', () => {
    expect(keepToolProgressMonotonic(42, 5)).toBe(42);
    expect(keepToolProgressMonotonic(42, 53)).toBe(53);
  });

  it('switches to an indeterminate bar once the remaining work has no size', () => {
    expect(isIndeterminateProgress(40)).toBe(false);
    expect(isIndeterminateProgress(89)).toBe(false);
    expect(isIndeterminateProgress(RUNNING_PROGRESS_CEILING)).toBe(true);
  });

  it('moves a tool bar before worker telemetry exists without claiming completion', () => {
    const startedAt = Date.parse('2026-08-30T12:00:00.000Z');
    expect(smoothPendingToolProgress(startedAt, startedAt)).toBe(4);
    expect(smoothPendingToolProgress(startedAt, startedAt + 2_000)).toBeGreaterThan(4);
    expect(smoothPendingToolProgress(startedAt, startedAt + 20 * 60_000)).toBeLessThanOrEqual(
      PENDING_PROGRESS_CEILING,
    );
  });
});
