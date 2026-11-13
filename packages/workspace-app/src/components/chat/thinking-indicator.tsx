'use client';

import { useEffect, useState } from 'react';
import { Component, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ThinkingIndicatorProps {
  /**
   * Ordered status lines shown one at a time. The indicator advances through
   * them and holds on the last, so the wait reads as step-by-step progress
   * (NotebookLM/ChatGPT style) rather than a single frozen label.
   */
  steps: readonly string[];
  /**
   * The glyph shown beside the steps -- a per-skill lucide icon so each kind of
   * work (search, analysis, charts, …) reads at a glance. Defaults to a neutral
   * `Component` mark.
   */
  icon?: LucideIcon;
  /** Hide the glyph when a surrounding row already shows one. */
  showIcon?: boolean;
  /**
   * A real, server-driven status line. When present it pins the display to
   * this message (still fading on change) instead of cycling `steps`, so
   * genuine progress -- e.g. a video analysis stage -- is never overwritten by
   * canned copy.
   */
  liveMessage?: string | null;
  /** Milliseconds each canned step stays before advancing to the next. */
  stepDurationMs?: number;
  className?: string;
}

const DEFAULT_STEP_DURATION_MS = 2200;

/**
 * A minimal, non-intrusive "the assistant is working" indicator: a per-skill
 * glyph and a status line, both carrying the same shimmer sweep, with the line
 * fading from one step to the next. Shared by every chat loading state (tool
 * runs, the pre-answer reasoning gap, source search) so progress reads
 * consistently across the product. No spinner, no progress bar.
 */
export function ThinkingIndicator({
  steps,
  icon,
  showIcon = true,
  liveMessage,
  stepDurationMs = DEFAULT_STEP_DURATION_MS,
  className,
}: ThinkingIndicatorProps) {
  const safeSteps = steps.length > 0 ? steps : ['Working…'];
  const stepsKey = safeSteps.join('\u0001');
  const hasLive = typeof liveMessage === 'string' && liveMessage.trim().length > 0;
  const Icon = icon ?? Component;

  const [index, setIndex] = useState(0);

  // Restart the cycle whenever the set of steps changes (a new tool).
  useEffect(() => {
    setIndex(0);
  }, [stepsKey]);

  // Advance through the canned steps and clamp on the final one. Paused while a
  // live message is driving the display.
  useEffect(() => {
    if (hasLive) return;
    if (index >= safeSteps.length - 1) return;
    const id = window.setTimeout(() => {
      setIndex((i) => Math.min(i + 1, safeSteps.length - 1));
    }, stepDurationMs);
    return () => window.clearTimeout(id);
  }, [hasLive, index, safeSteps.length, stepDurationMs]);

  const current = hasLive
    ? (liveMessage as string)
    : safeSteps[Math.min(index, safeSteps.length - 1)];

  return (
    <div className={cn('flex min-w-0 items-center gap-2 py-3', className)}>
      {showIcon ? (
        <Icon className="larkup-shimmer-icon size-4 shrink-0" aria-hidden="true" />
      ) : null}
      <span
        key={current}
        className="larkup-step-fade-in larkup-shimmer-text min-w-0 wrap-break-word text-[13px] font-medium leading-5"
        aria-live="polite"
        aria-atomic="true"
      >
        {current}
      </span>
    </div>
  );
}
