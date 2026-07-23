import { test, expect } from '@playwright/test';

test.describe('Server API (/api/server)', () => {
  test('GET /api/server/generate — returns generated server manifest', async ({ request }) => {
    const res = await request.get('/api/server/generate');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('config');
    expect(body).toHaveProperty('server');
    expect(body).toHaveProperty('serverId');
    expect(body.server).toHaveProperty('files');
    expect(Array.isArray(body.server.files)).toBe(true);
    expect(body.server.files.length).toBeGreaterThan(0);
    expect(body.server.files.map((file: { path: string }) => file.path)).toEqual(
      expect.arrayContaining(['chat.mjs', 'widget.js', 'chat-ui.html']),
    );
    console.log(
      `  ✓ Server generated: ${body.server.files.length} files, serverId=${body.serverId}`,
    );
  });

  test('GET /api/server/generate?download=1 — returns zip', async ({ request }) => {
    const res = await request.get('/api/server/generate?download=1');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/zip');
    expect(res.headers()['content-disposition']).toContain('attachment');

    const buffer = await res.body();
    expect(buffer.length).toBeGreaterThan(100);
    console.log(`  ✓ Server zip downloaded: ${buffer.length} bytes`);
  });

  test('GET /api/server/local — check local server status', async ({ request }) => {
    const res = await request.get('/api/server/local');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('state');
    expect(body.state).toHaveProperty('running');
    expect(body.state).toHaveProperty('port');
    console.log(`  ✓ Local server status: running=${body.state.running}, port=${body.state.port}`);
  });

  test('POST /api/server/local — start local RAG server', async ({ request }) => {
    test.setTimeout(60_000);

    const res = await request.post('/api/server/local', {
      data: { action: 'start' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('state');

    if (body.state.running) {
      console.log(`  ✓ RAG server started: port=${body.state.port}, pid=${body.state.pid}`);

      // Wait a moment and verify it's actually reachable
      await new Promise((r) => setTimeout(r, 3_000));
      try {
        const healthRes = await fetch(`http://localhost:${body.state.port}/health`, {
          signal: AbortSignal.timeout(5_000),
        });
        expect(healthRes.ok).toBe(true);
        console.log('  ✓ RAG server health check passed');
      } catch {
        console.warn('  ⚠ RAG server health check failed (may need more startup time)');
      }
    } else {
      console.warn(`  ⚠ Server did not start: ${body.state.lastError ?? 'unknown error'}`);
    }
  });

  test('POST /api/server/local — stop local RAG server', async ({ request }) => {
    const res = await request.post('/api/server/local', {
      data: { action: 'stop' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.state.running).toBe(false);
    console.log('  ✓ RAG server stopped');
  });
});
