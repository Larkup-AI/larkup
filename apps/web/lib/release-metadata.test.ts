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
    const workspaceServerPackage = readJson('packages/workspace-server/package.json');
    const rootPackage = readJson('package.json');
    const cliPackage = readJson('apps/cli/package.json');
    const corePackage = readJson('packages/core/package.json');
    const marketplacePackage = readJson('packages/marketplace/package.json');
    const vectorStoresPackage = readJson('packages/vector-stores/package.json');
    const sandboxPackage = readJson('packages/sandbox/package.json');
    const launcher = readFileSync(path.join(repoRoot, 'apps/web/bin/larkup.js'), 'utf8');
    const unixInstaller = readFileSync(path.join(repoRoot, 'scripts/install.sh'), 'utf8');
    const localInstaller = readFileSync(path.join(repoRoot, 'scripts/install-local.sh'), 'utf8');
    const windowsInstaller = readFileSync(path.join(repoRoot, 'scripts/install.ps1'), 'utf8');
    const npmPublisher = readFileSync(path.join(repoRoot, 'scripts/publish-npm.sh'), 'utf8');
    const dockerfile = readFileSync(path.join(repoRoot, 'docker/Dockerfile'), 'utf8');
    const dockerWorkflow = readFileSync(
      path.join(repoRoot, '.github/workflows/docker-build.yml'),
      'utf8',
    );

    expect(webPackage.dependencies['apache-arrow']).toBe('18.1.0');
    expect(webPackage.dependencies['@ai-sdk/anthropic']).toBe('4.0.85');
    expect(workspaceServerPackage.dependencies['@ai-sdk/anthropic']).toBe(
      webPackage.dependencies['@ai-sdk/anthropic'],
    );
    expect(webPackage.bundledDependencies).toContain('xlsx');
    expect(webPackage.dependencies.xlsx).toBe(
      'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz',
    );
    // The standalone output and its Next runtime must be the same patch
    // release. A range can install a newer runtime that expects build files
    // which the packaged output does not contain.
    expect(webPackage.dependencies.next).toMatch(/^\d+\.\d+\.\d+$/);
    expect(rootPackage.pnpm.overrides.next).toBe(webPackage.dependencies.next);
    expect(dockerfile).toContain(
      `@lancedb/lancedb@${webPackage.dependencies['@lancedb/lancedb'].replace(/^\D+/, '')}`,
    );
    expect(dockerfile).toContain(`@napi-rs/canvas@${webPackage.dependencies['@napi-rs/canvas']}`);
    expect(dockerfile).toContain('ARG LARKUP_VERSION');
    expect(dockerfile).toContain('next !== app.dependencies.next');
    expect(dockerWorkflow).toContain('LARKUP_VERSION=${{ steps.version.outputs.version }}');
    expect(dockerfile).not.toContain('fluent-ffmpeg');
    expect(cliPackage.dependencies['apache-arrow']).toBe('18.1.0');
    expect(vectorStoresPackage.dependencies['apache-arrow']).toBe('18.1.0');
    expect(webPackage.dependencies.tsx).toBeDefined();
    expect(webPackage.devDependencies.tsx).toBeUndefined();
    expect(marketplacePackage.dependencies.tsx).toBeDefined();
    expect(marketplacePackage.devDependencies.tsx).toBeUndefined();
    expect(sandboxPackage.optionalDependencies['@daytona/sdk']).toBeDefined();
    expect(sandboxPackage.optionalDependencies['@daytonaio/sdk']).toBeUndefined();
    expect(launcher).toContain("'--legacy-peer-deps'");
    expect(launcher).toContain("'--allow-remote=all'");
    expect(unixInstaller.match(/--allow-remote=all/g)).toHaveLength(2);
    expect(localInstaller).toContain('--allow-remote=all');
    expect(windowsInstaller).toContain('$npmCommand = Get-Command npm.cmd');
    expect(windowsInstaller).toContain(
      '& $npmCommand.Source install -g --no-fund --no-audit --ignore-scripts --legacy-peer-deps --allow-remote=all $spec',
    );
    expect(windowsInstaller).toContain('$ErrorActionPreference = "Continue"');
    expect(windowsInstaller).toContain('$ErrorActionPreference = $previousErrorActionPreference');
    expect(npmPublisher).toContain('npm_config_node_linker=hoisted pnpm changeset publish');
    expect(launcher).toContain("'--loglevel=error'");
    expect(launcher).toContain('https://registry.npmjs.org/larkup/latest');
    expect(launcher).toContain('`larkup@${latestVersion}`');
    expect(launcher).not.toContain("'@larkup/cli@latest'");
    expect(launcher).toContain('You already have the latest version.');
    expect(launcher).toContain("process.env.LARKUP_NO_OPEN !== '1'");
    expect(launcher).toContain("process.platform === 'win32' ? 'npm.cmd' : 'npm'");
    expect(launcher.match(/spawn\(\s*npmExecutable,/g)).toHaveLength(2);
    expect(launcher).not.toMatch(/spawn\(['"]npm['"],/);
    expect(launcher).toContain("new URL('/api/sandbox?action=setup', url)");
    expect(launcher).toContain("health.backend !== 'local'");
    expect(launcher).toContain(
      'Larkup is ready to open; analysis tools will activate when setup finishes.',
    );
    expect(launcher.indexOf('void prepareLocalAnalysisRuntime(url)')).toBeGreaterThan(
      launcher.indexOf('const child = spawn(process.execPath'),
    );
    expect(launcher).not.toContain('await prepareLocalAnalysisRuntime()');
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
    expect(corePackage.files).toEqual(['src', '!src/**/*.test.ts', 'CHANGELOG.md', 'dist-types']);
    expect(sandboxPackage.files).toEqual(['dist', 'Dockerfile', 'CHANGELOG.md']);
    expect(vectorStoresPackage.files).toEqual(['src', 'CHANGELOG.md']);
    expect(vectorStoresPackage.optionalDependencies.chromadb).toMatch(/^\^3\./);
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
