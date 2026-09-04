import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '../..');

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

describe('published npm metadata', () => {
  it('keeps global installer dependencies compatible and current', () => {
    const webPackage = readJson('apps/web/package.json');
    const cliPackage = readJson('apps/cli/package.json');
    const marketplacePackage = readJson('packages/marketplace/package.json');
    const vectorStoresPackage = readJson('packages/vector-stores/package.json');
    const sandboxPackage = readJson('packages/sandbox/package.json');
    const launcher = readFileSync(path.join(repoRoot, 'apps/web/bin/larkup.js'), 'utf8');

    expect(webPackage.dependencies['apache-arrow']).toBe('18.1.0');
    expect(cliPackage.dependencies['apache-arrow']).toBe('18.1.0');
    expect(vectorStoresPackage.dependencies['apache-arrow']).toBe('18.1.0');
    expect(webPackage.dependencies.tsx).toBeDefined();
    expect(webPackage.devDependencies.tsx).toBeUndefined();
    expect(marketplacePackage.dependencies.tsx).toBeDefined();
    expect(marketplacePackage.devDependencies.tsx).toBeUndefined();
    expect(sandboxPackage.optionalDependencies['@daytona/sdk']).toBeDefined();
    expect(sandboxPackage.optionalDependencies['@daytonaio/sdk']).toBeUndefined();
    expect(launcher).toContain("'--legacy-peer-deps'");
    expect(launcher).toContain("'--loglevel=error'");
    expect(launcher).toContain('https://registry.npmjs.org/larkup/latest');
    expect(launcher).toContain('`larkup@${latestVersion}`');
    expect(launcher).not.toContain("'@larkup/cli@latest'");
    expect(launcher).toContain('You already have the latest version.');
    for (const dependency of [
      '@larkup/connections',
      '@larkup/core',
      '@larkup/integrations',
      '@larkup/marketplace',
      '@larkup/sandbox',
      '@larkup/scraper',
      '@larkup/tool-doc-editor',
      '@larkup/vector-stores',
    ]) {
      expect(webPackage.dependencies[dependency]).not.toContain('workspace:');
    }
    expect(webPackage.files).toEqual(['bin', '.next/standalone/apps/web']);
  });

  it('scrubs local project state from every traced workspace before packing', () => {
    const testRoot = mkdtempSync(path.join(os.tmpdir(), 'larkup-standalone-'));
    const tracedPackage = path.join(testRoot, '.next/standalone/packages/example');
    const envFile = path.join(tracedPackage, '.env.local');
    const envExample = path.join(tracedPackage, '.env.example');
    const cacheFile = path.join(tracedPackage, '.next/cache/webpack/cache.pack');
    const devFile = path.join(tracedPackage, '.next/dev/cache/cache.sst');
    const virtualEnvironmentFile = path.join(
      tracedPackage,
      'runtime/.venv/site-packages/native.bin',
    );

    try {
      mkdirSync(path.join(tracedPackage, '.larkup/projects/local'), { recursive: true });
      mkdirSync(path.join(tracedPackage, '.larkupdb'), { recursive: true });
      writeFileSync(path.join(tracedPackage, '.larkup/projects/local/config.json'), '{}');
      writeFileSync(envFile, 'PRIVATE=value');
      writeFileSync(envExample, 'SAFE=example');
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      mkdirSync(path.dirname(devFile), { recursive: true });
      mkdirSync(path.dirname(virtualEnvironmentFile), { recursive: true });
      writeFileSync(cacheFile, 'cache');
      writeFileSync(devFile, 'dev cache');
      writeFileSync(virtualEnvironmentFile, 'environment');

      execFileSync(
        process.execPath,
        [path.join(repoRoot, 'apps/web/scripts/prepare-standalone.mjs')],
        {
          cwd: testRoot,
        },
      );

      expect(existsSync(path.join(tracedPackage, '.larkup'))).toBe(false);
      expect(existsSync(path.join(tracedPackage, '.larkupdb'))).toBe(false);
      expect(existsSync(envFile)).toBe(false);
      expect(existsSync(envExample)).toBe(true);
      expect(existsSync(cacheFile)).toBe(false);
      expect(existsSync(devFile)).toBe(false);
      expect(existsSync(virtualEnvironmentFile)).toBe(false);
    } finally {
      rmSync(testRoot, { force: true, recursive: true });
    }
  });
});
