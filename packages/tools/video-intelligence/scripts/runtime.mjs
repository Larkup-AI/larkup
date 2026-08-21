#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'status', ...args] = process.argv.slice(2);
const gpu = args.includes('--gpu');
const compose = ['compose', '-f', path.join(packageDir, 'compose.yaml')];
if (gpu) compose.push('-f', path.join(packageDir, 'compose.gpu.yaml'));

const actions = {
  start: [...compose, 'up', '-d', '--build', '--wait'],
  stop: [...compose, 'down'],
  status: [...compose, 'ps'],
  logs: [...compose, 'logs', '-f', '--tail=200'],
  pull: [...compose, 'pull'],
};

if (!(command in actions)) {
  console.error('Usage: larkup-video-intelligence <start|stop|status|logs|pull> [--gpu]');
  process.exit(2);
}
const result = spawnSync('docker', actions[command], { stdio: 'inherit' });
if (result.error) {
  console.error(`Could not run Docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
