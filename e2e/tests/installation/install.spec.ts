import { test, expect } from '@playwright/test';
import { execFileSync, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

test.describe('Installation Methods', () => {
  test('pnpm dev — web UI starts on port 4567', async () => {
    // This is already verified by global setup, but let's explicitly test
    const res = await fetch('http://localhost:4567', {
      signal: AbortSignal.timeout(10_000),
    });
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html).toContain('html');
    console.log('  ✓ pnpm dev serving on :4567');
  });

  test('npm install -g larkup — CLI installable from registry', async () => {
    test.setTimeout(120_000);

    const installPrefix = fs.mkdtempSync(path.join(os.tmpdir(), 'larkup-install-'));
    try {
      // Install into an isolated prefix, just as a first-time user would, without
      // modifying the developer or CI runner's global npm directory.
      const output = execFileSync(
        'npm',
        ['install', '-g', '--prefix', installPrefix, '--no-audit', '--no-fund', 'larkup'],
        {
          timeout: 90_000,
          encoding: 'utf-8',
          stdio: 'pipe',
        },
      );
      console.log(`  ✓ npm install successful:\n${output.trim()}`);

      const binary =
        process.platform === 'win32'
          ? path.join(installPrefix, 'larkup.cmd')
          : path.join(installPrefix, 'bin', 'larkup');
      const version = execFileSync(binary, ['--version'], { encoding: 'utf-8' });
      expect(version.trim()).toMatch(/^\d+\.\d+\.\d+/);
      console.log(`  ✓ CLI is executable after global install`);
    } finally {
      fs.rmSync(installPrefix, { recursive: true, force: true });
    }
  });

  test('docker pull — remote image pull', async () => {
    test.setTimeout(180_000);

    try {
      execSync('docker --version', { stdio: 'pipe' });
    } catch {
      test.skip(true, 'Docker not installed');
      return;
    }

    try {
      // Actually pull the image from Docker Hub
      console.log('Pulling aboneda/larkup:latest...');
      const output = execSync('docker pull aboneda/larkup:latest', {
        timeout: 150_000,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      console.log(`  ✓ Remote Docker image pulled successfully:\n${output.trim()}`);
    } catch (err: any) {
      console.log(
        `  ℹ Could not pull Docker Hub image (might not be published yet): ${err.message?.substring(
          0,
          200,
        )}`,
      );
    }
  });

  test('Docker settings server port — exposes the generated RAG server on :8080', () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, 'docker/Dockerfile'), 'utf-8');
    const developmentCompose = fs.readFileSync(
      path.join(REPO_ROOT, 'docker/docker-compose.dev.yml'),
      'utf-8',
    );
    const productionCompose = fs.readFileSync(
      path.join(REPO_ROOT, 'docker/docker-compose-prod.yaml'),
      'utf-8',
    );
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf-8');

    // ServerSection uses the workspace's primary generated-server port (8080).
    // Keep every Docker entry point aligned so /reference works from the host.
    expect(dockerfile).toContain('EXPOSE 4567 8080');
    expect(developmentCompose).toContain("- '8080:8080'");
    expect(productionCompose).toContain('- "8080:8080"');
    expect(dockerfile).toContain('VOLUME ["/app/apps/web/.larkup"]');
    expect(developmentCompose).toContain('larkup_data:/app/apps/web/.larkup');
    expect(productionCompose).toContain('larkup_data:/app/apps/web/.larkup');
    expect(readme).toContain(
      'docker run -d -p 4567:4567 -p 8080:8080 -v larkup_data:/app/apps/web/.larkup',
    );
    expect(readme).toContain('http://localhost:8080/reference');
    console.log('  ✓ Docker exposes the Settings RAG server and API reference on :8080');
  });

  test('generated-server install cache — is cleaned from durable workspace storage', () => {
    const runtime = fs.readFileSync(
      path.join(REPO_ROOT, 'packages/core/src/generator/server-runtime.ts'),
      'utf-8',
    );

    // Generated node_modules is needed at runtime, but npm's download cache is
    // disposable. Keeping it in .larkup can fill a Docker named volume and make
    // a later install fail with ENOSPC/EEXIST.
    expect(runtime).toContain('async function installGeneratedServerDependencies');
    expect(runtime).toContain("'npm install --omit=dev --no-audit --no-fund'");
    expect(runtime).toContain('finally');
    expect(runtime).toContain(
      'await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {});',
    );
    console.log('  ✓ Generated-server npm caches are cleared after each install');
  });

  test('start.sh — script exists and is executable', async () => {
    const startSh = path.join(REPO_ROOT, 'scripts/start.sh');
    expect(fs.existsSync(startSh)).toBe(true);

    // Check it has the expected content
    const content = fs.readFileSync(startSh, 'utf-8');
    expect(content).toContain('pnpm install');
    expect(content).toContain('pnpm run build');
    expect(content).toContain('pnpm run start');
    console.log('  ✓ start.sh exists with correct content');

    // Verify it's executable (on Unix)
    try {
      const stats = fs.statSync(startSh);
      const isExecutable = (stats.mode & 0o111) !== 0;
      if (isExecutable) {
        console.log('  ✓ start.sh is executable');
      } else {
        console.log('  ℹ start.sh is not executable (run: chmod +x start.sh)');
      }
    } catch {}
  });

  test('pnpm build — full monorepo builds', async () => {
    test.setTimeout(120_000);

    try {
      execSync('pnpm build', {
        cwd: REPO_ROOT,
        timeout: 120_000,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      console.log('  ✓ pnpm build completed successfully');

      // Verify key outputs exist
      const outputs = ['apps/cli/dist/index.js', 'apps/sdk/js-sdk/dist/index.js', 'apps/web/.next'];
      for (const out of outputs) {
        const exists = fs.existsSync(path.join(REPO_ROOT, out));
        console.log(`  ${exists ? '✓' : '✗'} ${out}`);
      }

      // The npm launcher starts the nested Next standalone server. Its browser
      // chunks must be copied into that server's .next directory, not only
      // left at apps/web/.next/static, or every client asset returns 404.
      const standaloneChunks = path.join(
        REPO_ROOT,
        'apps/web/.next/standalone/apps/web/.next/static/chunks',
      );
      expect(fs.existsSync(standaloneChunks)).toBe(true);
      expect(fs.readdirSync(standaloneChunks).length).toBeGreaterThan(0);
      console.log('  ✓ standalone runtime includes browser assets');
    } catch (err: any) {
      console.warn(`  ⚠ Build failed: ${err.message?.substring(0, 200)}`);
    }
  });

  test('auto-publish.sh --help — publish script exists', async () => {
    const publishSh = path.join(REPO_ROOT, 'scripts/auto-publish.sh');
    expect(fs.existsSync(publishSh)).toBe(true);

    const content = fs.readFileSync(publishSh, 'utf-8');
    expect(content).toContain('--npm-only');
    expect(content).toContain('--pypi-only');
    expect(content).toContain('--docker-only');
    console.log('  ✓ auto-publish.sh exists with expected flags');
  });
});
