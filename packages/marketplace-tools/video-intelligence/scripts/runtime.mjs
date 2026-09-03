#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'status', ...args] = process.argv.slice(2);
const envPath = path.join(packageDir, '.env');
const exampleEnvPath = path.join(packageDir, '.env.example');

function knownKeys() {
  return new Set(
    readFileSync(exampleEnvPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter(Boolean),
  );
}

function readEnvValue(key) {
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  if (!line) return '';
  const value = line.slice(key.length + 1).trim();
  if (!value.startsWith('"')) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function initializeEnv() {
  if (existsSync(envPath)) return;
  writeFileSync(envPath, readFileSync(exampleEnvPath, 'utf8'));
  console.log('Created .env from .env.example. Add credentials with `config set KEY VALUE`.');
}

function runtimeEnvironment() {
  if (!existsSync(envPath)) return process.env;
  return {
    ...process.env,
    ...Object.fromEntries(
      readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .flatMap((line) => {
          const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
          if (!match) return [];
          const [, key, raw] = match;
          try {
            return [[key, raw.startsWith('"') ? JSON.parse(raw) : raw]];
          } catch {
            return [[key, raw]];
          }
        }),
    ),
  };
}

function nativeRuntimeEnvironment() {
  const dataDir = path.join(process.cwd(), '.larkup', 'video-intelligence');
  return {
    ...runtimeEnvironment(),
    LARKUP_VIDEO_RUNTIME_KIND: 'local-process',
    LARKUP_VIDEO_HOST: '127.0.0.1',
    LARKUP_VIDEO_DATA_DIR: path.join(dataDir, 'data'),
    LARKUP_VIDEO_MODEL_DIR: path.join(dataDir, 'models'),
  };
}

function configure() {
  const [operation = 'path', key, ...valueParts] = args;
  if (operation === 'path') {
    console.log(envPath);
    return;
  }
  if (operation === 'init') {
    initializeEnv();
    return;
  }
  if (!key || !knownKeys().has(key)) {
    console.error('Use a key declared in .env.example. Run `config path` to find the file.');
    process.exitCode = 2;
    return;
  }
  if (operation === 'get') {
    console.log(readEnvValue(key));
    return;
  }
  if (
    operation !== 'set' ||
    valueParts.length === 0 ||
    valueParts.some((part) => /[\r\n]/.test(part))
  ) {
    console.error('Usage: larkup-video-intelligence config <init|path|get KEY|set KEY VALUE>');
    process.exitCode = 2;
    return;
  }
  initializeEnv();
  const value = valueParts.join(' ');
  const line = `${key}=${JSON.stringify(value)}`;
  const contents = readFileSync(envPath, 'utf8');
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  writeFileSync(
    envPath,
    pattern.test(contents) ? contents.replace(pattern, line) : `${contents}\n${line}\n`,
  );
  console.log(`Updated ${key} in .env.`);
}

if (command === 'config') {
  configure();
  process.exit(process.exitCode ?? 0);
}

if (command === 'start') initializeEnv();
const accelerator = readEnvValue('LARKUP_VIDEO_ACCELERATOR').toLowerCase();
const gpu = args.includes('--gpu') || accelerator === 'gpu' || accelerator === 'cuda';
const compose = ['compose', '-f', path.join(packageDir, 'compose.yaml')];
if (gpu) compose.push('-f', path.join(packageDir, 'compose.gpu.yaml'));

const actions = {
  start: [...compose, 'up', '-d', '--build', '--wait'],
  stop: [...compose, 'down'],
  status: [...compose, 'ps'],
  logs: [...compose, 'logs', '-f', '--tail=200'],
  pull: [...compose, 'pull'],
  native: [
    'run',
    '--directory',
    path.join(packageDir, 'runtime'),
    '--extra',
    'cpu',
    'larkup-video-runtime',
  ],
};

if (!(command in actions)) {
  console.error(
    'Usage: larkup-video-intelligence <start|stop|status|logs|pull|native> [--gpu]\\n' +
      '       larkup-video-intelligence config <init|path|get KEY|set KEY VALUE>',
  );
  process.exit(2);
}
const result = spawnSync(command === 'native' ? 'uv' : 'docker', actions[command], {
  stdio: 'inherit',
  env: command === 'native' ? nativeRuntimeEnvironment() : process.env,
});
if (result.error) {
  console.error(`Could not run Docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
