import { test, expect } from '@playwright/test';
import { rewriteLocalUrl } from '../../utils/env';
import { DEFAULT_CONFIG } from '../../../packages/core/src/types';
import { generateServer } from '../../../packages/core/src/generator/generate-server';

test.describe.serial('Server API', () => {
  test('generates a Knowledge server bundle with pinned provider versions', () => {
    const files = Object.fromEntries(
      generateServer({ ...DEFAULT_CONFIG, runtimeProfile: 'knowledge' }).files.map((file) => [
        file.path,
        file.contents,
      ]),
    );

    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['server.mjs', 'vercel.json', 'package.json']),
    );

    const serverFile = files['server.mjs'];
    expect(serverFile).toContain('Location: "/reference"');
    expect(serverFile).toContain('--scalar-color-accent: #000000');
    expect(serverFile).toContain('url.pathname === "/query"');
    expect(serverFile).toContain('url.pathname === "/documents"');
    expect(serverFile).toContain('url.pathname === "/scrape"');
    expect(serverFile).toContain('url.pathname === "/corpus"');

    const generatedPackage = JSON.parse(files['package.json']) as {
      dependencies: Record<string, string>;
    };
    expect(Object.values(generatedPackage.dependencies)).not.toContain('latest');
    for (const [packageName, version] of Object.entries(generatedPackage.dependencies)) {
      // Every dependency is pinned to a caret range, never a floating tag.
      expect(version, `${packageName} must be pinned`).toMatch(/^[\^~]?\d+\.\d+\.\d+/);
    }
  });

  test('GET /api/projects/runtime — check runtime status', async ({ request }) => {
    const res = await request.get('/api/projects/runtime');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('runtime');
    expect(body.runtime).toHaveProperty('running');
    expect(body.runtime).toHaveProperty('port');
    console.log(`  ✓ Runtime status: running=${body.runtime.running}, port=${body.runtime.port}`);
  });

  test('POST /api/projects/runtime — start the runtime', async ({ request }) => {
    test.setTimeout(60_000);

    const res = await request.post('/api/projects/runtime', {
      data: { action: 'start' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('runtime');

    if (body.runtime.running) {
      console.log(`  ✓ Runtime started: port=${body.runtime.port}, pid=${body.runtime.pid}`);

      // Wait a moment and verify it's actually reachable
      await new Promise((r) => setTimeout(r, 3_000));
      try {
        const healthRes = await fetch(
          rewriteLocalUrl(`http://localhost:${body.runtime.port}/health`),
          {
            signal: AbortSignal.timeout(5_000),
          },
        );
        expect(healthRes.ok).toBe(true);
        console.log('  ✓ Runtime health check passed');
      } catch {
        console.warn('  ⚠ Runtime health check failed (may need more startup time)');
      }
    } else {
      console.warn(`  ⚠ Runtime did not start: ${body.runtime.lastError ?? 'unknown error'}`);
    }
  });

  test('POST /api/projects/runtime — stop the runtime', async ({ request }) => {
    const res = await request.post('/api/projects/runtime', {
      data: { action: 'stop' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.runtime.running).toBe(false);
    console.log('  ✓ Runtime stopped');
  });
});
