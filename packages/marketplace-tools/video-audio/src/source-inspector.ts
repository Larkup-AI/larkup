import { promises as fs } from 'node:fs';
import { inspectTimeRange } from './video-processor.js';
import type { InspectionRequest, InspectionResult } from './contracts.js';

export interface BoundedSourceInspectionRequest extends InspectionRequest {
  /** Derived-frame byte cap; source media itself is never copied into the result. */
  maxOutputBytes?: number;
}

/**
 * Applies an output-byte ceiling around the decoder primitive. Local paths are
 * only returned to the owning worker and are intended to be deleted with its
 * temporary workspace.
 */
export async function inspectBoundedSource(
  request: BoundedSourceInspectionRequest,
): Promise<InspectionResult> {
  const result = await inspectTimeRange(request);
  const maxOutputBytes = Math.max(0, request.maxOutputBytes ?? 256 * 1024 * 1024);
  let usedBytes = 0;
  const frames = [] as InspectionResult['frames'];
  for (const frame of result.frames) {
    const size = (await fs.stat(frame.path)).size;
    if (usedBytes + size > maxOutputBytes) {
      await fs.unlink(frame.path).catch(() => {});
      continue;
    }
    usedBytes += size;
    frames.push(frame);
  }
  return { ...result, frames };
}
