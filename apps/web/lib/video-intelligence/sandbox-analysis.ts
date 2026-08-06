import { SandboxManager } from '@larkup/sandbox';
import type { AnalysisBundle } from './analysis-bundle';

export type ApprovedVideoAnalysis = 'frame-inventory' | 'timestamp-coverage';

/** Runs only fixed, reviewable operators; callers cannot submit generated code. */
export async function analyzeBundle(bundle: AnalysisBundle, operation: ApprovedVideoAnalysis) {
  const code =
    operation === 'frame-inventory'
      ? "import json; m=json.load(open('/sandbox/input/manifest.json')); print(json.dumps({'frameCount': len(m['frames']), 'timestamps': [f['timestampSecs'] for f in m['frames']]}))"
      : "import json; m=json.load(open('/sandbox/input/manifest.json')); t=[f['timestampSecs'] for f in m['frames']]; print(json.dumps({'coveredStartSecs': min(t) if t else None, 'coveredEndSecs': max(t) if t else None, 'frameCount': len(t)}))";
  const sandbox = new SandboxManager({
    backend: 'docker',
    docker: { networkDisabled: true, timeoutMs: 120_000, memoryMB: 512 },
  });
  return sandbox.execute({ code, language: 'python', files: bundle.files, timeout: 120_000 });
}
