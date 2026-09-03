'use client';

import { useEffect, useRef, useState } from 'react';
import {
  advanceMediaProcessingProgress,
  isMediaStepTelemetryStale,
  primaryRunningMediaStep,
  smoothMediaProcessingProgress,
  type MediaProgressStep,
} from '@/lib/media/progress';

type LiveMediaAsset = {
  id: string;
  processingProgress?: number;
  processingStatus: string;
  processingPaused?: boolean;
  processingStartedAt?: string;
  durationSecs?: number;
  processingSteps?: MediaProgressStep[];
};

/** Smooths sparse worker updates without crossing the active stage boundary. */
export function useLiveMediaProgress(asset: LiveMediaAsset): number {
  const latestAsset = useRef(asset);
  latestAsset.current = asset;
  const attempt = `${asset.id}:${asset.processingStartedAt ?? ''}`;
  const previousAttempt = useRef(attempt);
  const [displayed, setDisplayed] = useState(() =>
    asset.processingStatus === 'completed'
      ? 100
      : Math.max(0, Math.min(100, asset.processingProgress ?? 0)),
  );

  if (previousAttempt.current !== attempt) {
    previousAttempt.current = attempt;
  }

  useEffect(() => {
    setDisplayed(
      asset.processingStatus === 'completed'
        ? 100
        : Math.max(0, Math.min(100, asset.processingProgress ?? 0)),
    );
  }, [attempt]);

  useEffect(() => {
    if (asset.processingStatus === 'completed') {
      setDisplayed(100);
      return;
    }
    if (asset.processingStatus !== 'processing' || asset.processingPaused) return;

    let previousTick = Date.now();
    const tick = () => {
      const now = Date.now();
      const elapsedMs = now - previousTick;
      previousTick = now;
      const currentAsset = latestAsset.current;
      const confirmed = smoothMediaProcessingProgress(currentAsset, now);
      const activeStep = primaryRunningMediaStep(currentAsset.processingSteps);
      const workerActive = Boolean(activeStep && !isMediaStepTelemetryStale(activeStep, now));
      setDisplayed((current) =>
        advanceMediaProcessingProgress(current, confirmed, elapsedMs, workerActive),
      );
    };
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [asset.processingPaused, asset.processingStatus, attempt]);

  return displayed;
}
