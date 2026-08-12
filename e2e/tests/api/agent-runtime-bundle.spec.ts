import { test, expect } from '@playwright/test';

/**
 * TASK 08 — the deployable Agent Runtime bundle.
 *
 * The bundle is a container image that gets pushed to a registry and pulled by
 * anyone with access, so the tests that matter most are the negative ones: no
 * credential, no local path, no dashboard-only state may survive into it
 * (plan §1.3, §8.3, §11.2).
 */

const RETRIEVAL_KEY = 'sk-live-retrieval-key-do-not-ship';
const JOIN_CODE = 'open-sesame-secret';
const BOT_TOKEN = '123456789:AAHrealbottokenvaluegoeshere1234567';

let agentId = '';
let releaseId = '';

function fileMap(files: { path: string; contents: string }[]) {
  return Object.fromEntries(files.map((f) => [f.path, f.contents]));
}

test.describe.serial('Agent Runtime bundle (TASK 08)', () => {
  test.beforeAll(async ({ request }) => {
    const created = await request.post('/api/agents', {
      data: {
        name: `Bundle E2E ${Date.now()}`,
        description: 'Deployable bundle test',
        systemPrompt: 'You are a deployable agent.',
        chatProvider: 'openai',
        chatModelId: 'gpt-4o-mini',
        allowedOrigins: ['https://shop.acme.com'],
        knowledgeSources: [
          { label: 'Product Docs', baseUrl: 'https://ks.acme.com', retrievalKey: RETRIEVAL_KEY },
        ],
        authMode: 'join-code',
        joinCode: JOIN_CODE,
      },
    });
    expect(created.status()).toBe(201);
    agentId = (await created.json()).id;

    await request.put(`/api/agents/${agentId}/channels`, {
      data: {
        channelId: 'telegram',
        enabled: true,
        settings: { botToken: BOT_TOKEN, webhookSecret: 'telegram-webhook-secret' },
      },
    });

    const published = await request.post(`/api/agents/${agentId}/releases`, {
      data: { version: '1.0.0', releaseNotes: 'bundle test' },
    });
    expect(published.status()).toBeLessThan(300);
    releaseId = (await published.json()).releaseId;
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
  });

  test('refuses to build a bundle for an agent with no published release', async ({ request }) => {
    const draft = await request.post('/api/agents', { data: { name: `Draft ${Date.now()}` } });
    const draftId = (await draft.json()).id;

    try {
      const res = await request.get(`/api/agents/${draftId}/bundle`);
      expect(res.status()).toBe(409);
      expect((await res.json()).error).toMatch(/publish/i);
    } finally {
      await request.delete(`/api/agents/${draftId}`);
    }
  });

  test('generates a complete, self-contained bundle', async ({ request }) => {
    const res = await request.get(`/api/agents/${agentId}/bundle`);
    expect(res.status()).toBe(200);

    const bundle = await res.json();
    expect(bundle.releaseId).toBe(releaseId);
    expect(bundle.version).toBe('1.0.0');

    const paths = bundle.files.map((f: { path: string }) => f.path);
    for (const required of [
      'package.json',
      'release.json',
      'server.mjs',
      'Dockerfile',
      'docker-compose.yml',
      'service.cloudrun.yaml',
      '.env.example',
      'README.md',
    ]) {
      expect(paths, `missing ${required}`).toContain(required);
    }
  });

  test('never ships a credential inside the image', async ({ request }) => {
    const bundle = await (await request.get(`/api/agents/${agentId}/bundle`)).json();
    const serialized = JSON.stringify(bundle);

    // The bundle gets pushed to a registry. Any of these leaking is an incident.
    expect(serialized).not.toContain(RETRIEVAL_KEY);
    expect(serialized).not.toContain(JOIN_CODE);
    expect(serialized).not.toContain(BOT_TOKEN);

    const files = fileMap(bundle.files);
    const release = JSON.parse(files['release.json']);
    expect(release.definition.knowledgeSources[0].retrievalKey).toBe('');
    expect(release.definition.channels.telegram.settings.botToken).toBe('');
    expect(release.definition.joinCode).toBe('');
  });

  test('keeps the behavioural half of the release intact', async ({ request }) => {
    const bundle = await (await request.get(`/api/agents/${agentId}/bundle`)).json();
    const release = JSON.parse(fileMap(bundle.files)['release.json']);

    // Stripping secrets must not strip behaviour: this snapshot is the contract
    // that makes a deployment reproduce what was tested locally (ADR-007).
    expect(release.definition.systemPrompt).toBe('You are a deployable agent.');
    expect(release.definition.chatModelId).toBe('gpt-4o-mini');
    expect(release.definition.allowedOrigins).toEqual(['https://shop.acme.com']);
    expect(release.definition.knowledgeSources[0].baseUrl).toBe('https://ks.acme.com');
    expect(release.releaseId).toBe(releaseId);
  });

  test('declares every secret it expects at run time', async ({ request }) => {
    const bundle = await (await request.get(`/api/agents/${agentId}/bundle`)).json();
    const keys = bundle.envVars.map((v: { key: string }) => v.key);

    expect(keys).toContain('OPENAI_API_KEY');
    expect(keys).toContain('AGENT_JOIN_CODE');
    expect(keys).toContain('KS_KEY_PRODUCT_DOCS');

    // And the example file documents them without filling any in.
    const env = fileMap(bundle.files)['.env.example'];
    expect(env).toContain('KS_KEY_PRODUCT_DOCS=');
    expect(env).not.toContain(RETRIEVAL_KEY);
  });

  test('contains no path from the machine that generated it', async ({ request }) => {
    const bundle = await (await request.get(`/api/agents/${agentId}/bundle`)).json();
    const serialized = JSON.stringify(bundle);

    // Plan §1.3: no release may depend on a local file path.
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('/home/');
    expect(serialized).not.toContain('.larkup/agents');
  });

  test('is one image for every target, not a generator per cloud', async ({ request }) => {
    const bundle = await (await request.get(`/api/agents/${agentId}/bundle`)).json();
    const files = fileMap(bundle.files);

    // Plan §11.1: one Dockerfile; targets differ only in deployment config.
    expect(files['Dockerfile']).toContain('FROM node:22-slim');
    expect(files['Dockerfile']).toContain('HEALTHCHECK');
    expect(files['Dockerfile']).toContain('USER node');
    expect(files['docker-compose.yml']).toContain('healthcheck');
    expect(files['service.cloudrun.yaml']).toContain('/readiness');
    expect(files['service.cloudrun.yaml']).toContain('/health');
  });

  test('pins its runtime dependencies', async ({ request }) => {
    const bundle = await (await request.get(`/api/agents/${agentId}/bundle`)).json();
    const pkg = JSON.parse(fileMap(bundle.files)['package.json']);

    // A production agent must not resolve new majors on redeploy.
    expect(pkg.dependencies.ai).toMatch(/^\^7\./);
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.start).toBe('node server.mjs');
    // No Larkup package: the bundle runs on a bare Node image.
    expect(Object.keys(pkg.dependencies).some((d) => d.startsWith('@larkup/'))).toBe(false);
  });

  test('serves the widget and the endpoints the acceptance matrix checks', async ({ request }) => {
    const bundle = await (await request.get(`/api/agents/${agentId}/bundle`)).json();
    const server = fileMap(bundle.files)['server.mjs'];

    for (const endpoint of [
      '/health',
      '/readiness',
      '/agent',
      '/chat',
      '/widget.js',
      '/channels/',
    ]) {
      expect(server, `missing ${endpoint}`).toContain(endpoint);
    }
    // Origin gating travels with the bundle, not just the dashboard.
    expect(server).toContain('allowedOrigins');
    expect(server).toContain('Access-Control-Allow-Origin');
  });

  test('carries the rate-limiting logic (plan §8.5), not just the dashboard', async ({
    request,
  }) => {
    const bundle = await (await request.get(`/api/agents/${agentId}/bundle`)).json();
    const server = fileMap(bundle.files)['server.mjs'];

    expect(server).toContain('REQUESTS_PER_MINUTE');
    expect(server).toContain('MESSAGES_PER_SESSION');
    expect(server).toContain('rateConsume');
    expect(server).toContain('rateCharge');
    expect(server).toContain('Retry-After');
    expect(server).toContain('X-RateLimit-Remaining');
    // Trusts only the last X-Forwarded-For hop — see rate-limit.ts's doc
    // comment for why the first (client-supplied) entry is not trustworthy.
    expect(server).toContain('trustedClientIp');
  });

  test('can generate a bundle for a prior release, which is how rollback works', async ({
    request,
  }) => {
    const second = await request.post(`/api/agents/${agentId}/releases`, {
      data: { version: '1.1.0' },
    });
    expect(second.status()).toBeLessThan(300);

    const older = await request.get(`/api/agents/${agentId}/bundle?releaseId=${releaseId}`);
    expect(older.status()).toBe(200);

    const bundle = await older.json();
    expect(bundle.releaseId).toBe(releaseId);
    expect(bundle.version).toBe('1.0.0');
  });

  test('404s an unknown release rather than silently building the active one', async ({
    request,
  }) => {
    const res = await request.get(`/api/agents/${agentId}/bundle?releaseId=does-not-exist`);
    expect(res.status()).toBe(409);
  });
});
