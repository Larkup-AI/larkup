import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { SandboxFile } from '@larkup/sandbox';

export interface AnalysisBundleFrame {
  /** Worker-local path. It is read here and never escapes into the bundle manifest. */
  path: string;
  timestampSecs: number;
  evidenceId?: string;
}

export interface AnalysisBundle {
  id: string;
  mediaAssetId: string;
  range: { startSecs: number; endSecs: number };
  files: SandboxFile[];
  manifest: {
    version: 1;
    mediaAssetId: string;
    range: { startSecs: number; endSecs: number };
    frames: Array<{ name: string; timestampSecs: number; evidenceId?: string }>;
  };
}

export async function createAnalysisBundle(input: {
  mediaAssetId: string;
  range: { startSecs: number; endSecs: number };
  frames: AnalysisBundleFrame[];
  maxBytes: number;
}): Promise<AnalysisBundle> {
  let usedBytes = 0;
  const files: SandboxFile[] = [];
  const manifestFrames: AnalysisBundle['manifest']['frames'] = [];
  for (const [index, frame] of input.frames.entries()) {
    const bytes = await fs.readFile(frame.path);
    if (usedBytes + bytes.length > input.maxBytes) break;
    usedBytes += bytes.length;
    const name = `frame-${String(index).padStart(4, '0')}.jpg`;
    files.push({ name, content: bytes.toString('base64'), isBase64: true });
    manifestFrames.push({ name, timestampSecs: frame.timestampSecs, evidenceId: frame.evidenceId });
  }
  const manifest: AnalysisBundle['manifest'] = {
    version: 1,
    mediaAssetId: input.mediaAssetId,
    range: input.range,
    frames: manifestFrames,
  };
  files.push({ name: 'manifest.json', content: JSON.stringify(manifest) });
  return {
    id: randomUUID(),
    mediaAssetId: input.mediaAssetId,
    range: input.range,
    files,
    manifest,
  };
}
