/**
 * Docker-based sandbox runner.
 *
 * Uses `dockerode` to manage ephemeral containers for code execution.
 * Each execution spins up a container, runs the code, captures output +
 * generated files, then auto-removes the container.
 */

import Docker from 'dockerode';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type {
  DockerConfig,
  ExecutionRequest,
  ExecutionResult,
  ExecutionArtifact,
  SandboxHealthCheck,
  DEFAULT_DOCKER_CONFIG,
} from './types.js';

const SANDBOX_IMAGE = 'larkup-sandbox:latest';
const OUTPUT_DIR = '/sandbox/output';
const INPUT_DIR = '/sandbox/input';
const DOCKERFILE_DIR = path.join(import.meta.dirname ?? __dirname, '..');

let dockerInstance: Docker | null = null;

function getDocker(): Docker {
  if (!dockerInstance) {
    dockerInstance = new Docker();
  }
  return dockerInstance;
}

/* ------------------------------------------------------------------ */
/* Health check                                                        */
/* ------------------------------------------------------------------ */

export async function checkDockerHealth(): Promise<SandboxHealthCheck> {
  const docker = getDocker();
  try {
    const info = await docker.version();
    const images = await docker.listImages({
      filters: { reference: [SANDBOX_IMAGE] },
    });
    return {
      status: images.length > 0 ? 'ready' : 'image-not-found',
      backend: 'docker',
      dockerVersion: info.Version,
      imageReady: images.length > 0,
    };
  } catch (err: any) {
    return {
      status: 'docker-not-found',
      backend: 'docker',
      error: err.message ?? 'Docker daemon not available',
    };
  }
}

/* ------------------------------------------------------------------ */
/* Image management                                                    */
/* ------------------------------------------------------------------ */

export async function buildSandboxImage(onProgress?: (msg: string) => void): Promise<void> {
  const docker = getDocker();
  const dockerfilePath = path.join(DOCKERFILE_DIR, 'Dockerfile');

  // Check if Dockerfile exists in the package
  try {
    await fs.access(dockerfilePath);
  } catch {
    throw new Error(
      `Sandbox Dockerfile not found at ${dockerfilePath}. ` +
        `Ensure the @larkup/sandbox package is properly installed.`,
    );
  }

  onProgress?.('Building sandbox image…');

  const stream = await docker.buildImage(
    { context: DOCKERFILE_DIR, src: ['Dockerfile'] },
    { t: SANDBOX_IMAGE },
  );

  // Follow the build stream to completion
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      },
      (event: any) => {
        if (event.stream) {
          onProgress?.(event.stream.trim());
        }
      },
    );
  });

  onProgress?.('Sandbox image built successfully ✓');
}

export async function ensureImage(): Promise<boolean> {
  const docker = getDocker();
  const images = await docker.listImages({
    filters: { reference: [SANDBOX_IMAGE] },
  });
  if (images.length > 0) return true;

  try {
    await buildSandboxImage();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Code execution                                                      */
/* ------------------------------------------------------------------ */

/**
 * Build the Python wrapper script that:
 * 1. Sets up pandas compatibility shims to handle deprecated APIs
 * 2. Auto-imports common data analysis modules
 * 3. Runs the user code with robust error handling
 * 4. Saves any matplotlib figures to /sandbox/output/
 * 5. Lists generated artifacts
 */
function wrapPythonCode(code: string): string {
  return `
import sys, os, json, traceback

# Ensure output directory exists
os.makedirs("${OUTPUT_DIR}", exist_ok=True)

# ============================================================
# SAFETY PREAMBLE: Suppress warnings & patch deprecated APIs
# ============================================================
import warnings
warnings.filterwarnings('ignore', category=FutureWarning)
warnings.filterwarnings('ignore', category=DeprecationWarning)
warnings.filterwarnings('ignore', category=UserWarning)

# Auto-import common data analysis modules
import numpy as np

try:
    import pandas as pd

    # --- Patch 1: DataFrame.append() was removed in pandas 2.0 ---
    if not hasattr(pd.DataFrame, 'append'):
        def _df_append(self, other, ignore_index=False, verify_integrity=False, sort=False, **kwargs):
            """Backwards-compatible append using pd.concat."""
            if isinstance(other, (list, tuple)):
                to_concat = [self] + list(other)
            elif isinstance(other, dict):
                to_concat = [self, pd.DataFrame([other])]
            else:
                to_concat = [self, other]
            return pd.concat(to_concat, ignore_index=ignore_index, verify_integrity=verify_integrity, sort=sort)
        pd.DataFrame.append = _df_append

    # --- Patch 2: Series.append() was removed in pandas 2.0 ---
    if not hasattr(pd.Series, 'append'):
        def _series_append(self, to_append, ignore_index=False, verify_integrity=False):
            """Backwards-compatible Series.append using pd.concat."""
            if isinstance(to_append, (list, tuple)):
                to_concat = [self] + list(to_append)
            else:
                to_concat = [self, to_append]
            return pd.concat(to_concat, ignore_index=ignore_index, verify_integrity=verify_integrity)
        pd.Series.append = _series_append

    # --- Patch 3: Fix deprecated resample frequency aliases ---
    # "M" -> "ME", "Q" -> "QE", "Y" -> "YE", "H" -> "h", "T" -> "min", "S" -> "s"
    _original_resample = pd.DataFrame.resample
    _FREQ_ALIAS_MAP = {
        'M': 'ME', 'Q': 'QE', 'Y': 'YE', 'A': 'YE',
        'BM': 'BME', 'BQ': 'BQE', 'BA': 'BYE', 'BY': 'BYE',
        'BMS': 'BMS', 'QS': 'QS', 'AS': 'YS', 'BAS': 'BYS',
        'H': 'h', 'T': 'min', 'S': 's', 'L': 'ms', 'U': 'us', 'N': 'ns',
    }
    def _patched_resample(self, rule, *args, **kwargs):
        if isinstance(rule, str) and rule in _FREQ_ALIAS_MAP:
            rule = _FREQ_ALIAS_MAP[rule]
        return _original_resample(self, rule, *args, **kwargs)
    pd.DataFrame.resample = _patched_resample

    # Also patch Series.resample
    _original_series_resample = pd.Series.resample
    def _patched_series_resample(self, rule, *args, **kwargs):
        if isinstance(rule, str) and rule in _FREQ_ALIAS_MAP:
            rule = _FREQ_ALIAS_MAP[rule]
        return _original_series_resample(self, rule, *args, **kwargs)
    pd.Series.resample = _patched_series_resample

    # --- Patch 4: Fix pd.Grouper freq aliases ---
    _original_grouper = pd.Grouper
    class _PatchedGrouper(_original_grouper):
        def __init__(self, *args, **kwargs):
            if 'freq' in kwargs and isinstance(kwargs['freq'], str):
                kwargs['freq'] = _FREQ_ALIAS_MAP.get(kwargs['freq'], kwargs['freq'])
            super().__init__(*args, **kwargs)
    pd.Grouper = _PatchedGrouper

except ImportError:
    pass

# ============================================================
# Patch matplotlib to auto-save figures
# ============================================================
_figure_count = [0]
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    _original_show = plt.show
    def _patched_show(*args, **kwargs):
        for fig_num in plt.get_fignums():
            fig = plt.figure(fig_num)
            fname = f"${OUTPUT_DIR}/chart_{_figure_count[0]}.png"
            fig.savefig(fname, dpi=150, bbox_inches="tight", facecolor="white")
            _figure_count[0] += 1
        plt.close("all")
    plt.show = _patched_show
except ImportError:
    pass

# ============================================================
# Execute user code with robust error handling
# ============================================================
try:
    exec(${JSON.stringify(code)})
    
    # Auto-save any remaining matplotlib figures
    try:
        import matplotlib.pyplot as plt
        if plt.get_fignums():
            plt.show()
    except (ImportError, Exception):
        pass
except SystemExit as e:
    # Let explicit sys.exit() calls through
    if e.code != 0:
        sys.exit(e.code)
except Exception as e:
    # Print a clean, user-readable error instead of raw traceback
    error_type = type(e).__name__
    error_msg = str(e)
    print(f"Error ({error_type}): {error_msg}", file=sys.stderr)
    # Also print the relevant part of the traceback for debugging
    tb = traceback.extract_tb(sys.exc_info()[2])
    # Filter to only show the exec'd code frames (skip wrapper frames)
    user_frames = [f for f in tb if f.filename == '<string>']
    if user_frames:
        last = user_frames[-1]
        print(f"  at line {last.lineno}: {last.line}", file=sys.stderr)
    sys.exit(1)

# List generated artifacts
artifacts = []
if os.path.isdir("${OUTPUT_DIR}"):
    for f in sorted(os.listdir("${OUTPUT_DIR}")):
        fp = os.path.join("${OUTPUT_DIR}", f)
        if os.path.isfile(fp):
            artifacts.append(f)
if artifacts:
    print("\\n__ARTIFACTS__:" + json.dumps(artifacts))
`;
}

export async function executeInDocker(
  request: ExecutionRequest,
  config: DockerConfig,
): Promise<ExecutionResult> {
  const docker = getDocker();
  const startTime = Date.now();

  // Create a temporary directory for input files
  const tmpDir = path.join(os.tmpdir(), `larkup-sandbox-${randomUUID()}`);
  const inputDir = path.join(tmpDir, 'input');
  const outputDir = path.join(tmpDir, 'output');
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  // Write input files
  if (request.files) {
    for (const file of request.files) {
      const filePath = path.join(inputDir, file.name);
      if (file.isBase64) {
        await fs.writeFile(filePath, Buffer.from(file.content, 'base64'));
      } else {
        await fs.writeFile(filePath, file.content, 'utf8');
      }
    }
  }

  // Prepare the execution code
  let execCode: string;
  let cmd: string[];

  if (request.language === 'python') {
    execCode = wrapPythonCode(request.code);
    const scriptPath = path.join(tmpDir, 'run.py');
    await fs.writeFile(scriptPath, execCode, 'utf8');
    cmd = ['python3', '/sandbox/run.py'];
  } else {
    // JavaScript/TypeScript (future)
    const scriptPath = path.join(tmpDir, 'run.js');
    await fs.writeFile(scriptPath, request.code, 'utf8');
    cmd = ['node', '/sandbox/run.js'];
  }

  const timeout = request.timeout ?? config.timeoutMs;

  let container: Docker.Container | null = null;
  try {
    container = await docker.createContainer({
      Image: config.imageName,
      Cmd: cmd,
      Entrypoint: [],
      WorkingDir: '/sandbox/input',
      HostConfig: {
        AutoRemove: false,
        Memory: config.memoryMB * 1024 * 1024,
        CpuShares: config.cpuShares,
        NetworkMode: config.networkDisabled ? 'none' : 'bridge',
        Binds: [
          `${inputDir}:${INPUT_DIR}:ro`,
          `${outputDir}:${OUTPUT_DIR}:rw`,
          `${tmpDir}/run.py:/sandbox/run.py:ro`,
        ],
        ReadonlyRootfs: false,
      },
      Tty: false,
      AttachStdout: true,
      AttachStderr: true,
    });

    await container.start();

    // Wait for completion with timeout
    const waitPromise = container.wait();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(async () => {
        try {
          await container?.kill();
        } catch {
          /* container may have already stopped */
        }
        reject(new Error(`Execution timed out after ${timeout}ms`));
      }, timeout);
    });

    const result = await Promise.race([waitPromise, timeoutPromise]);

    // Capture logs
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
    });

    const logStr = demuxDockerStream(logs as unknown as Buffer);

    // Collect artifacts from output directory
    const artifacts: ExecutionArtifact[] = [];
    try {
      const files = await fs.readdir(outputDir);
      for (const file of files) {
        const filePath = path.join(outputDir, file);
        const content = await fs.readFile(filePath);
        const ext = path.extname(file).toLowerCase();
        const mimeType = getMimeType(ext);
        artifacts.push({
          name: file,
          mimeType,
          data: content.toString('base64'),
        });
      }
    } catch {
      /* output dir may not exist */
    }

    // Parse stdout/stderr from demuxed logs
    const { stdout, stderr } = logStr;

    return {
      stdout: cleanArtifactMarkers(stdout),
      stderr,
      exitCode: (result as any).StatusCode ?? 1,
      artifacts,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      stdout: '',
      stderr: err.message ?? 'Execution failed',
      exitCode: 1,
      artifacts: [],
      executionTimeMs: Date.now() - startTime,
    };
  } finally {
    // Cleanup
    if (container) {
      try {
        await container.remove({ force: true });
      } catch {
        /* already removed */
      }
    }
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Docker multiplexes stdout/stderr into a single stream with 8-byte headers.
 * Header format: [type(1)][0(3)][size(4)] where type: 1=stdout, 2=stderr
 */
function demuxDockerStream(buffer: Buffer): {
  stdout: string;
  stderr: string;
} {
  let stdout = '';
  let stderr = '';

  if (typeof buffer === 'string') {
    return { stdout: buffer, stderr: '' };
  }

  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    const type = buffer.readUInt8(offset);
    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > buffer.length) break;
    const payload = buffer.subarray(offset, offset + size).toString('utf8');
    if (type === 1) stdout += payload;
    else if (type === 2) stderr += payload;
    offset += size;
  }

  if (!stdout && !stderr && buffer.length > 0) {
    stdout = buffer.toString('utf8');
  }

  return { stdout, stderr };
}

function cleanArtifactMarkers(stdout: string): string {
  return stdout.replace(/\n__ARTIFACTS__:.*$/m, '').trimEnd();
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.gif': 'image/gif',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.pdf': 'application/pdf',
  };
  return map[ext] ?? 'application/octet-stream';
}
