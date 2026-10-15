#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(repoRoot, 'apps', 'web');
const requiredFiles = [
  '.next/standalone/apps/web/server.js',
  '.next/standalone/apps/web/package.json',
  '.next/standalone/apps/web/.next/BUILD_ID',
];

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(packageRoot, relativePath);
  if (!existsSync(absolutePath) || statSync(absolutePath).size === 0) {
    fail(`Missing required production artifact: ${relativePath}`);
  }
}

const packCache = mkdtempSync(path.join(os.tmpdir(), 'larkup-npm-pack-'));
let packed;
try {
  packed = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NPM_CONFIG_CACHE: packCache },
    },
  );
} finally {
  rmSync(packCache, { recursive: true, force: true });
}

if (packed.status !== 0) {
  process.stderr.write(packed.stderr || packed.stdout);
  fail('npm pack --dry-run failed.');
}

let manifest;
try {
  [manifest] = JSON.parse(packed.stdout);
} catch {
  fail('npm pack --dry-run returned an unreadable manifest.');
}

const packedFiles = new Set((manifest?.files ?? []).map((file) => file.path));
for (const relativePath of requiredFiles) {
  if (!packedFiles.has(relativePath)) {
    fail(`npm would omit required production artifact: ${relativePath}`);
  }
}

const hasBrowserAssets = [...packedFiles].some((file) =>
  file.startsWith('.next/standalone/apps/web/.next/static/chunks/'),
);
if (!hasBrowserAssets) {
  fail('npm would omit the standalone browser assets.');
}

if (!Number.isFinite(manifest?.unpackedSize) || manifest.unpackedSize < 1_000_000) {
  fail(`Packed runtime is unexpectedly small (${manifest?.unpackedSize ?? 'unknown'} bytes).`);
}

console.log(
  `Verified larkup@${manifest.version}: ${manifest.files.length} files, ${manifest.unpackedSize} unpacked bytes.`,
);

function fail(message) {
  console.error(`Larkup npm package verification failed: ${message}`);
  process.exit(1);
}
