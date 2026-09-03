import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { VideoIntelligenceClient } from './client.js';
import type { LocalVideoRuntimeKind } from './contracts.js';

const execute = promisify(execFile);

const LOCAL_DOCKER_IMAGE = 'ghcr.io/larkup-ai/video-intelligence:0.1.0';

/** Optional AI/audio configuration injected into the local runtime. */
export interface VideoUnderstandingEnvConfig {
  visionProvider?: string;
  visionApiKey?: string;
  semanticVisionModel?: string;
  agentProvider?: string;
  agentApiKey?: string;
  agentModel?: string;
  audioProvider?: string;
  audioApiKey?: string;
  audioModel?: string;
  videoEmbeddingProvider?: string;
  dashscopeApiKey?: string;
  dashscopeWorkspaceId?: string;
  dashscopeRegion?: string;
  runpodEmbeddingApiKey?: string;
  runpodEmbeddingEndpointId?: string;
  hfEmbeddingUrl?: string;
  hfEmbeddingApiKey?: string;
}

export interface LocalAcceleration {
  /** The execution device selected for work that stays on the user's machine. */
  device: 'cuda' | 'cpu';
  /** True only when Docker can pass the detected NVIDIA GPU through safely. */
  dockerSupported: boolean;
  /** True when the native runtime can install CUDA-enabled dependencies. */
  nativeSupported: boolean;
  gpuName?: string;
  gpuMemoryGB?: number;
  message: string;
}

/** Starts the shipped local runtime only after the user selected local Docker mode. */
export async function ensureVideoRuntime(
  client: VideoIntelligenceClient,
  mode: 'local-docker' | 'local-process' | 'managed-cloud' | 'custom-remote',
  localApiKey?: string,
  localRuntimeUrl?: string,
  understanding?: VideoUnderstandingEnvConfig,
): Promise<void> {
  try {
    await client.health();
    return;
  } catch (error) {
    if (mode !== 'local-docker' && mode !== 'local-process') throw error;
  }
  if (mode === 'local-process') {
    await startNativeVideoRuntime(client, localApiKey, localRuntimeUrl, understanding);
    return;
  }
  const packageDirectory = resolvePackageDirectory();
  const acceleration = await detectLocalAcceleration();
  try {
    await execute(
      'docker',
      ['compose', ...dockerComposeFiles(packageDirectory, acceleration), 'up', '-d', '--wait'],
      {
        timeout: 15 * 60_000,
        maxBuffer: 1024 * 1024,
        env: localRuntimeEnvironment(localApiKey, localRuntimeUrl, understanding, acceleration),
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'Docker Desktop is required for the local runtime. Install it and make sure Docker is running.',
      );
    }
    throw error;
  }
  await client.health();
}

/** Recreates the local container so a changed shared key is applied immediately. */
export async function restartVideoRuntime(
  mode: 'local-docker' | 'local-process',
  localApiKey?: string,
  localRuntimeUrl?: string,
  understanding?: VideoUnderstandingEnvConfig,
): Promise<void> {
  if (mode === 'local-process') {
    const packageDirectory = resolvePackageDirectory();
    stopNativeVideoRuntime(nativePidPath(packageDirectory));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const client = new VideoIntelligenceClient({
      mode: 'local-process',
      endpoint: localRuntimeUrl,
      apiKey: localApiKey,
    });
    await startNativeVideoRuntime(client, localApiKey, localRuntimeUrl, understanding);
    return;
  }
  const packageDirectory = resolvePackageDirectory();
  const acceleration = await detectLocalAcceleration();
  try {
    await execute(
      'docker',
      [
        'compose',
        ...dockerComposeFiles(packageDirectory, acceleration),
        'up',
        '-d',
        '--force-recreate',
        '--wait',
      ],
      {
        timeout: 15 * 60_000,
        maxBuffer: 1024 * 1024,
        env: localRuntimeEnvironment(localApiKey, localRuntimeUrl, understanding, acceleration),
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'Docker Desktop is required for the local runtime. Install it and make sure Docker is running.',
      );
    }
    throw error;
  }
}

/** Stops the local runtime without removing the installed image/dependencies. */
export async function stopVideoRuntime(): Promise<void> {
  const packageDirectory = resolvePackageDirectory();
  // The preferred runtime can change after installation (for example when a
  // GPU or Docker becomes available). Stop both owned variants so the status
  // never remains Running because we guessed the wrong one.
  stopNativeVideoRuntime(nativePidPath(packageDirectory));
  try {
    await execute(
      'docker',
      ['compose', '-f', path.join(packageDirectory, 'compose.yaml'), 'stop'],
      {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      },
    );
  } catch {
    // A native runtime may be the active one while Docker is unavailable.
    // Health is checked by the caller, so only a still-running endpoint is an
    // actionable stop failure.
  }
}

/** Removes local runtime state only after the user explicitly removes the tool. */
export async function removeVideoRuntime(kind: LocalVideoRuntimeKind): Promise<void> {
  const packageDirectory = resolvePackageDirectory();
  if (kind === 'local-process') {
    stopNativeVideoRuntime(nativePidPath(packageDirectory));
    rmSync(path.join(process.cwd(), '.larkup', 'video-intelligence'), {
      recursive: true,
      force: true,
    });
    return;
  }
  try {
    await execute(
      'docker',
      [
        'compose',
        '-f',
        path.join(packageDirectory, 'compose.yaml'),
        'down',
        '--volumes',
        '--rmi',
        'local',
      ],
      { timeout: 2 * 60_000, maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

/**
 * Prepares whatever a local kind needs, without starting it: pulls the Docker
 * image, or installs uv (via astral's official curl|sh installer when it is
 * missing) and syncs the native runtime's Python dependencies.
 */
export async function installLocalRuntime(
  kind: LocalVideoRuntimeKind,
  localApiKey?: string,
  localRuntimeUrl?: string,
  understanding?: VideoUnderstandingEnvConfig,
): Promise<void> {
  if (kind === 'local-docker') {
    try {
      const packageDirectory = resolvePackageDirectory();
      const acceleration = await detectLocalAcceleration();
      if (acceleration.dockerSupported) {
        await execute(
          'docker',
          ['compose', ...dockerComposeFiles(packageDirectory, acceleration), 'build'],
          { timeout: 30 * 60_000, maxBuffer: 1024 * 1024 },
        );
        return;
      }
      await execute('docker', ['pull', LOCAL_DOCKER_IMAGE], {
        timeout: 20 * 60_000,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'Docker Desktop is required for the local runtime. Install it and make sure Docker is running.',
        );
      }
      throw error;
    }
    return;
  }
  const packageDirectory = resolvePackageDirectory();
  const runtimeDirectory = path.join(packageDirectory, 'runtime');
  const native = await detectNativeHost();
  const acceleration = await detectLocalAcceleration();
  if (!native.uvInstalled) {
    try {
      await execute('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], {
        timeout: 5 * 60_000,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      throw new Error(
        `Could not install uv automatically. Install it yourself from https://docs.astral.sh/uv/ and try again. (${
          error instanceof Error ? error.message : 'unknown error'
        })`,
      );
    }
  }
  await execute(
    'uv',
    [
      'sync',
      '--directory',
      runtimeDirectory,
      '--extra',
      acceleration.nativeSupported ? 'gpu' : 'cpu',
    ],
    {
      timeout: 15 * 60_000,
      maxBuffer: 1024 * 1024,
      env: nativeRuntimeEnvironment(
        packageDirectory,
        localApiKey,
        localRuntimeUrl,
        understanding,
        acceleration,
      ),
    },
  );
}

export interface DockerHostStatus {
  cliInstalled: boolean;
  daemonRunning: boolean;
  imagePulled: boolean;
  message: string;
}

export interface GpuHostStatus {
  available: boolean;
  name?: string;
  memoryGB?: number;
  message: string;
}

/** `docker info` (not just `docker --version`) so a stopped daemon is distinguished from a missing CLI. */
export async function detectDockerHost(): Promise<DockerHostStatus> {
  try {
    await execute('docker', ['info'], { timeout: 8_000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        cliInstalled: false,
        daemonRunning: false,
        imagePulled: false,
        message: "Docker isn't installed on this machine.",
      };
    }
    return {
      cliInstalled: true,
      daemonRunning: false,
      imagePulled: false,
      message:
        'Docker is installed but not running. Start Docker Desktop (or the Docker engine) and try again.',
    };
  }
  let imagePulled = false;
  try {
    await execute('docker', ['image', 'inspect', LOCAL_DOCKER_IMAGE], {
      timeout: 8_000,
      maxBuffer: 1024 * 1024,
    });
    imagePulled = true;
  } catch {
    imagePulled = false;
  }
  return { cliInstalled: true, daemonRunning: true, imagePulled, message: 'Docker is ready.' };
}

/**
 * Detect NVIDIA through its driver utility rather than assuming any GPU can
 * run CUDA. Apple/AMD devices correctly stay on the efficient CPU path until
 * there is a supported local operator build for them.
 */
export async function detectNvidiaGpu(): Promise<GpuHostStatus> {
  try {
    const { stdout } = await execute(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 8_000, maxBuffer: 64 * 1024 },
    );
    const first = stdout.trim().split(/\r?\n/, 1)[0];
    const match = first?.match(/^\s*(.+?)\s*,\s*([\d.]+)\s*$/);
    if (!match) return { available: false, message: 'No supported NVIDIA GPU was detected.' };
    const memoryMB = Number(match[2]);
    return {
      available: true,
      name: match[1].trim(),
      ...(Number.isFinite(memoryMB) ? { memoryGB: memoryMB / 1024 } : {}),
      message: `${match[1].trim()} detected${
        Number.isFinite(memoryMB) ? ` (${(memoryMB / 1024).toFixed(1)} GB)` : ''
      }.`,
    };
  } catch {
    return { available: false, message: 'No supported NVIDIA GPU was detected.' };
  }
}

/** Selects the fastest supported local path; it never selects a Larkup-managed worker. */
export async function detectLocalAcceleration(): Promise<LocalAcceleration> {
  const [gpu, docker] = await Promise.all([detectNvidiaGpu(), detectDockerHost()]);
  let dockerSupported = false;
  if (gpu.available && docker.daemonRunning && os.platform() === 'linux') {
    try {
      const { stdout } = await execute('docker', ['info', '--format', '{{json .Runtimes}}'], {
        timeout: 8_000,
        maxBuffer: 64 * 1024,
      });
      const runtimes = JSON.parse(stdout) as Record<string, unknown>;
      dockerSupported = 'nvidia' in runtimes;
    } catch {
      dockerSupported = false;
    }
  }
  if (gpu.available) {
    const memory = gpu.memoryGB ? ` with ${gpu.memoryGB.toFixed(1)} GB VRAM` : '';
    return {
      device: 'cuda',
      dockerSupported,
      nativeSupported: true,
      gpuName: gpu.name,
      gpuMemoryGB: gpu.memoryGB,
      message: dockerSupported
        ? `${gpu.name} will accelerate local video processing${memory}.`
        : `${gpu.name} is available for the native local runtime${memory}. Docker GPU support is not available on this machine.`,
    };
  }
  return {
    device: 'cpu',
    dockerSupported: false,
    nativeSupported: false,
    message:
      'No CUDA-capable NVIDIA GPU is available, so local processing will use this computer’s CPU.',
  };
}

export interface NativeHostStatus {
  uvInstalled: boolean;
  depsInstalled: boolean;
  message: string;
}

export async function detectNativeHost(): Promise<NativeHostStatus> {
  try {
    await execute('uv', ['--version'], {
      timeout: 8_000,
      maxBuffer: 1024 * 1024,
      env: withUvPath(),
    });
  } catch {
    return {
      uvInstalled: false,
      depsInstalled: false,
      message: 'uv is not installed on this machine.',
    };
  }
  const runtimeDirectory = path.join(resolvePackageDirectory(), 'runtime');
  const depsInstalled = existsSync(path.join(runtimeDirectory, '.venv'));
  return {
    uvInstalled: true,
    depsInstalled,
    message: depsInstalled
      ? 'Native runtime is ready.'
      : 'uv is installed; Python dependencies are not synced yet.',
  };
}

export interface LocalRuntimeHostReport {
  docker: DockerHostStatus;
  native: NativeHostStatus;
  recommendedKind: LocalVideoRuntimeKind | null;
  installed: boolean;
  system: { platform: NodeJS.Platform; cpus: number; totalMemGB: number; freeMemGB: number };
  acceleration: LocalAcceleration;
  suitability: { level: 'good' | 'tight' | 'unknown'; message: string };
}

/** Live-detects Docker vs. native every call so the UI never trusts a stale persisted choice. */
export async function detectLocalRuntimeHost(): Promise<LocalRuntimeHostReport> {
  const [docker, native, acceleration] = await Promise.all([
    detectDockerHost(),
    detectNativeHost(),
    detectLocalAcceleration(),
  ]);
  const recommendedKind: LocalVideoRuntimeKind | null = acceleration.dockerSupported
    ? 'local-docker'
    : acceleration.nativeSupported
    ? 'local-process'
    : docker.daemonRunning
    ? 'local-docker'
    : native.uvInstalled
    ? 'local-process'
    : null;
  const totalMemGB = os.totalmem() / 1024 ** 3;
  const freeMemGB = os.freemem() / 1024 ** 3;
  const cpus = os.cpus().length;
  const suitability: LocalRuntimeHostReport['suitability'] =
    recommendedKind === 'local-docker'
      ? freeMemGB < 6
        ? {
            level: 'tight',
            message: `Only ${freeMemGB.toFixed(
              1,
            )} GB RAM is free; the ~8 GB Docker image runs better with more headroom. The native runtime is lighter, or close other apps first.`,
          }
        : {
            level: 'good',
            message: `${freeMemGB.toFixed(
              1,
            )} GB RAM free across ${cpus} CPU cores — comfortable for the Docker runtime.`,
          }
      : recommendedKind === 'local-process'
      ? acceleration.nativeSupported
        ? {
            level: 'good',
            message: `${acceleration.message} The native runtime is recommended so it can use the GPU directly.`,
          }
        : freeMemGB < 3
        ? {
            level: 'tight',
            message: `Only ${freeMemGB.toFixed(
              1,
            )} GB RAM is free; the native CPU runtime may run slowly.`,
          }
        : {
            level: 'good',
            message: `${freeMemGB.toFixed(
              1,
            )} GB RAM free across ${cpus} CPU cores — the native runtime should run well.`,
          }
      : {
          level: 'unknown',
          message:
            'Neither Docker nor uv was detected yet. Installing will set up uv automatically.',
        };
  return {
    docker,
    native,
    recommendedKind,
    installed: docker.imagePulled || native.depsInstalled,
    system: { platform: os.platform(), cpus, totalMemGB, freeMemGB },
    acceleration,
    suitability,
  };
}

/**
 * Starts the portable Python runtime through uv. This keeps Docker optional
 * while retaining the exact same HTTP and job contract as the container.
 */
async function startNativeVideoRuntime(
  client: VideoIntelligenceClient,
  localApiKey?: string,
  localRuntimeUrl?: string,
  understanding?: VideoUnderstandingEnvConfig,
): Promise<void> {
  const packageDirectory = resolvePackageDirectory();
  const runtimeDirectory = path.join(packageDirectory, 'runtime');
  const acceleration = await detectLocalAcceleration();
  const environment = nativeRuntimeEnvironment(
    packageDirectory,
    localApiKey,
    localRuntimeUrl,
    understanding,
    acceleration,
  );
  const child = spawn(
    'uv',
    [
      'run',
      '--directory',
      runtimeDirectory,
      '--extra',
      acceleration.nativeSupported ? 'gpu' : 'cpu',
      'larkup-video-runtime',
    ],
    { detached: true, stdio: 'ignore', env: environment },
  );
  await new Promise<void>((resolve, reject) => {
    const ready = setTimeout(resolve, 100);
    child.once('error', (error) => {
      clearTimeout(ready);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error('The native runtime requires uv. Install it from https://docs.astral.sh/uv/.'),
        );
        return;
      }
      reject(error);
    });
  });
  child.unref();
  const pidFile = nativePidPath(packageDirectory);
  mkdirSync(path.dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, `${child.pid ?? ''}\n`, 'utf8');

  const deadline = Date.now() + 5 * 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await client.health();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(
    `The native Video Intelligence runtime did not become ready. ${
      lastError instanceof Error
        ? lastError.message
        : 'Check that uv can install the CPU dependencies.'
    }`,
  );
}

function resolvePackageDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function nativePidPath(packageDirectory: string) {
  return path.join(process.cwd(), '.larkup', 'video-intelligence', 'runtime.pid');
}

export function stopNativeVideoRuntime(pidFile: string) {
  if (!existsSync(pidFile)) return;
  const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  try {
    if (Number.isSafeInteger(pid) && pid > 0) process.kill(pid, 'SIGTERM');
  } catch {
    // The process may already have exited; a new runtime can still be launched.
  } finally {
    unlinkSync(pidFile);
  }
}

/** Prepends common uv install locations so a runtime started right after a fresh curl|sh install can find it. */
function withUvPath(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extra = [path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin')];
  return { ...env, PATH: [...extra, env.PATH ?? ''].filter(Boolean).join(path.delimiter) };
}

function localRuntimeEnvironment(
  localApiKey?: string,
  localRuntimeUrl?: string,
  understanding?: VideoUnderstandingEnvConfig,
  acceleration?: LocalAcceleration,
) {
  const port = portFromUrl(localRuntimeUrl);
  return {
    ...process.env,
    // This selects only hardware on the user's machine. It does not contact
    // Modal, RunPod, or any Larkup-managed worker.
    LARKUP_VIDEO_DEVICE: acceleration?.dockerSupported ? 'cuda' : 'cpu',
    ...(port ? { LARKUP_VIDEO_PORT: port } : {}),
    ...(localApiKey
      ? { LARKUP_VIDEO_REQUIRE_AUTH: 'true', LARKUP_VIDEO_SHARED_API_KEY: localApiKey }
      : {}),
    ...videoUnderstandingEnvironment(understanding),
  };
}

function nativeRuntimeEnvironment(
  packageDirectory: string,
  localApiKey?: string,
  localRuntimeUrl?: string,
  understanding?: VideoUnderstandingEnvConfig,
  acceleration?: LocalAcceleration,
) {
  const port = portFromUrl(localRuntimeUrl) ?? '8787';
  const hostname = hostnameFromUrl(localRuntimeUrl);
  const dataDirectory = path.join(process.cwd(), '.larkup', 'video-intelligence');
  return withUvPath({
    ...process.env,
    LARKUP_VIDEO_PORT: port,
    LARKUP_VIDEO_RUNTIME_KIND: 'local-process',
    LARKUP_VIDEO_HOST:
      hostname && hostname !== '127.0.0.1' && hostname !== 'localhost' ? '0.0.0.0' : '127.0.0.1',
    LARKUP_VIDEO_DATA_DIR: path.join(dataDirectory, 'data'),
    LARKUP_VIDEO_MODEL_DIR: path.join(dataDirectory, 'models'),
    LARKUP_VIDEO_DEVICE: acceleration?.nativeSupported ? 'cuda' : 'cpu',
    ...(localApiKey
      ? { LARKUP_VIDEO_REQUIRE_AUTH: 'true', LARKUP_VIDEO_SHARED_API_KEY: localApiKey }
      : {}),
    ...videoUnderstandingEnvironment(understanding),
  });
}

export function videoUnderstandingEnvironment(
  config?: VideoUnderstandingEnvConfig,
): Record<string, string> {
  // Explicit blanks avoid a developer shell/.env accidentally changing a
  // user's Local runtime. Remote calls below are always direct calls using the
  // user's selected provider and key—not Larkup-managed compute.
  const env: Record<string, string> = {
    LARKUP_VIDEO_SEMANTIC_VISION: 'false',
    LARKUP_VIDEO_VISION_PROVIDER: 'vercel_ai_gateway',
    LARKUP_VIDEO_VISION_API_KEY: '',
    AI_GATEWAY_API_KEY: '',
    LARKUP_VIDEO_EMBEDDING_PROVIDER: 'disabled',
    LARKUP_VIDEO_AGENT_ENABLED: 'false',
    LARKUP_VIDEO_AGENT_PROVIDER: 'vercel_ai_gateway',
    LARKUP_VIDEO_AGENT_API_KEY: '',
    LARKUP_VIDEO_AGENT_MODEL: 'openai/gpt-5-mini',
    LARKUP_VIDEO_TRANSCRIPTION_PROVIDER: '',
    LARKUP_VIDEO_TRANSCRIPTION_FALLBACK: '',
    LARKUP_VIDEO_DEEPGRAM_MODEL: '',
    LARKUP_VIDEO_DEEPGRAM_AUTO_MODEL: '',
    LARKUP_VIDEO_OPENAI_TRANSCRIPTION_MODEL: '',
    LARKUP_VIDEO_GROQ_TRANSCRIPTION_MODEL: '',
    LARKUP_VIDEO_ELEVENLABS_TRANSCRIPTION_MODEL: '',
    DEEPGRAM_API_KEY: '',
    OPENAI_API_KEY: '',
    GROQ_API_KEY: '',
    ELEVENLABS_API_KEY: '',
  };
  if (!config) return env;
  if (config.visionProvider) env.LARKUP_VIDEO_VISION_PROVIDER = config.visionProvider;
  if (config.semanticVisionModel)
    env.LARKUP_VIDEO_SEMANTIC_VISION_MODEL = config.semanticVisionModel;
  if (config.visionApiKey) {
    env.LARKUP_VIDEO_SEMANTIC_VISION = 'true';
    env.LARKUP_VIDEO_VISION_API_KEY = config.visionApiKey;
    if (config.visionProvider === 'vercel_ai_gateway') {
      env.AI_GATEWAY_API_KEY = config.visionApiKey;
    }
  }
  if (config.agentProvider) env.LARKUP_VIDEO_AGENT_PROVIDER = config.agentProvider;
  if (config.agentModel) env.LARKUP_VIDEO_AGENT_MODEL = config.agentModel;
  if (config.agentApiKey) {
    env.LARKUP_VIDEO_AGENT_ENABLED = 'true';
    env.LARKUP_VIDEO_AGENT_API_KEY = config.agentApiKey;
  }
  if (config.audioProvider)
    env.LARKUP_VIDEO_TRANSCRIPTION_PROVIDER =
      config.audioProvider === 'local' || config.audioProvider === 'larkup-cloud'
        ? 'whisper'
        : config.audioProvider;
  if (config.audioModel) {
    if (config.audioProvider === 'deepgram') {
      env.LARKUP_VIDEO_DEEPGRAM_MODEL = config.audioModel;
      env.LARKUP_VIDEO_DEEPGRAM_AUTO_MODEL = config.audioModel;
    }
    if (config.audioProvider === 'openai') {
      env.LARKUP_VIDEO_OPENAI_TRANSCRIPTION_MODEL = config.audioModel;
    }
    if (config.audioProvider === 'groq') {
      env.LARKUP_VIDEO_GROQ_TRANSCRIPTION_MODEL = config.audioModel;
    }
    if (config.audioProvider === 'elevenlabs') {
      env.LARKUP_VIDEO_ELEVENLABS_TRANSCRIPTION_MODEL = config.audioModel;
    }
  }
  if (config.audioProvider === 'deepgram' && config.audioApiKey)
    env.DEEPGRAM_API_KEY = config.audioApiKey;
  if (config.audioProvider === 'openai' && config.audioApiKey)
    env.OPENAI_API_KEY = config.audioApiKey;
  if (config.audioProvider === 'groq' && config.audioApiKey) env.GROQ_API_KEY = config.audioApiKey;
  if (config.audioProvider === 'elevenlabs' && config.audioApiKey)
    env.ELEVENLABS_API_KEY = config.audioApiKey;
  if (config.videoEmbeddingProvider) {
    env.LARKUP_VIDEO_EMBEDDING_PROVIDER = config.videoEmbeddingProvider;
  } else if (config.visionProvider === 'vercel_ai_gateway' && config.visionApiKey) {
    // The same user-owned Gateway key can create multimodal document/query
    // vectors. Enabling it here keeps Local retrieval RAG-first without
    // requiring a second provider setting; an explicit `disabled` still wins.
    env.LARKUP_VIDEO_EMBEDDING_PROVIDER = 'gateway-gemini-embedding-2';
  }
  if (config.dashscopeApiKey) env.DASHSCOPE_API_KEY = config.dashscopeApiKey;
  if (config.dashscopeWorkspaceId) env.DASHSCOPE_WORKSPACE_ID = config.dashscopeWorkspaceId;
  if (config.dashscopeRegion) env.DASHSCOPE_REGION = config.dashscopeRegion;
  if (config.runpodEmbeddingApiKey) env.RUNPOD_API_KEY = config.runpodEmbeddingApiKey;
  if (config.runpodEmbeddingEndpointId)
    env.LARKUP_VIDEO_RUNPOD_EMBEDDING_ENDPOINT_ID = config.runpodEmbeddingEndpointId;
  if (config.hfEmbeddingUrl) env.LARKUP_VIDEO_HF_EMBEDDING_URL = config.hfEmbeddingUrl;
  if (config.hfEmbeddingApiKey) env.HF_TOKEN = config.hfEmbeddingApiKey;
  return env;
}

function dockerComposeFiles(packageDirectory: string, acceleration: LocalAcceleration): string[] {
  const files = ['-f', path.join(packageDirectory, 'compose.yaml')];
  if (acceleration.dockerSupported)
    files.push('-f', path.join(packageDirectory, 'compose.gpu.yaml'));
  return files;
}

function portFromUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const port = new URL(value).port;
    return port && Number.isInteger(Number(port)) && Number(port) > 0 && Number(port) < 65_536
      ? port
      : undefined;
  } catch {
    return undefined;
  }
}

function hostnameFromUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}
