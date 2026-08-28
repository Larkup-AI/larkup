import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { DEFAULT_CONFIG } from '../../../packages/core/src/types';
import { generateServer } from '../../../packages/core/src/generator/generate-server';
import { resolveRuntimePluginVersion } from '../../../packages/core/src/generator/server-runtime';

function generatedFiles(profile: 'knowledge' | 'assistant') {
  return Object.fromEntries(
    generateServer({
      ...DEFAULT_CONFIG,
      runtimeProfile: profile,
      enabledTools: ['searchKnowledgeBase', 'getIndexedData'],
    }).files.map((file) => [file.path, file.contents]),
  );
}

test.describe('Generated Agent Server contract', () => {
  test('bundles a workspace Marketplace tool into portable runtimes', () => {
    const plugin = {
      id: 'example',
      source: 'local' as const,
      resolvedPath: '/workspace/packages/marketplace-tools/example',
      version: '1.2.3',
    };

    expect(resolveRuntimePluginVersion(plugin)).toBe('file:/workspace/packages/marketplace-tools/example');
    expect(resolveRuntimePluginVersion(plugin, true)).toBe('file:./marketplace-tools/example');

    const generated = generateServer({
      ...DEFAULT_CONFIG,
      runtimeProfile: 'assistant',
      agentPlugins: [
        {
          id: 'example',
          packageName: '@example/marketplace-tool',
          version: resolveRuntimePluginVersion(plugin, true),
        },
      ],
    });
    const packageJson = generated.files.find((file) => file.path === 'package.json')?.contents;

    expect(packageJson).toContain('"@example/marketplace-tool": "file:./marketplace-tools/example"');
    expect(packageJson).not.toContain('file:/workspace/packages/marketplace-tools/example');
  });

  test('keeps Knowledge endpoints separate from Agent tools and streaming endpoints', () => {
    const agent = generatedFiles('assistant');
    const knowledge = generatedFiles('knowledge');

    expect(agent['server.mjs']).toContain('name: "Knowledge"');
    expect(agent['server.mjs']).toContain('name: "Agent"');
    expect(agent['server.mjs']).toContain('url.pathname === "/agent/tools"');
    expect(agent['server.mjs']).toContain('url.pathname === "/agent/capabilities"');
    expect(agent['server.mjs']).toContain('url.pathname === "/agent/configuration"');
    expect(agent['server.mjs']).toContain('url.pathname === "/agent/sandbox"');
    expect(agent['server.mjs']).toContain('url.pathname === "/widget.js"');
    expect(agent['server.mjs']).toContain('url.pathname === "/models"');
    expect(agent['server.mjs']).toContain('url.pathname === "/v1/chat/completions"');
    expect(agent['server.mjs']).toContain(
      'Stream an Agent response using the AI SDK UI message protocol',
    );
    expect(agent['chat.mjs']).toContain('pipeUIMessageStreamToResponse');
    expect(agent['chat.mjs']).toContain('searchKnowledgeBase = tool');
    expect(agent['chat.mjs']).toContain('createMCPClient');
    expect(agent['chat.mjs']).toContain('SandboxManager');
    expect(agent['chat.mjs']).toContain('resolveRequestedChatModel');
    expect(agent['chat.mjs']).toContain('listAgentCapabilities');
    expect(agent['chat.mjs']).toContain('getAgentRuntimeConfiguration');
    expect(agent['chat.mjs']).toContain('getAgentSandboxStatus');
    expect(agent['chat.mjs']).toContain('CONFIGURED_BUILT_IN_TOOLS');
    expect(agent['chat.mjs']).toContain('Treat first- and second-person statements');
    expect(agent['widget.mjs']).toContain('data.apiKey');
    expect(agent['widget.mjs']).toContain("host + '/chat'");
    expect(agent['models.mjs']).toContain('https://ai-gateway.vercel.sh/v1/models');
    expect(agent['package.json']).toContain('"zod": "^4.4.3"');
    expect(agent['package.json']).toContain('"@ai-sdk/mcp": "2.0.26"');
    expect(agent['package.json']).toContain('"@larkup/sandbox": "^0.1.2"');

    expect(knowledge['server.mjs']).not.toContain('url.pathname === "/agent/tools"');
    expect(knowledge['server.mjs']).not.toContain('url.pathname === "/agent/capabilities"');
    expect(knowledge['server.mjs']).not.toContain('url.pathname === "/widget.js"');
    expect(knowledge['widget.mjs']).toBeUndefined();
    expect(knowledge['server.mjs']).not.toContain('url.pathname === "/v1/chat/completions"');
    expect(knowledge['chat.mjs']).not.toContain('pipeUIMessageStreamToResponse');
    expect(knowledge['chat.mjs']).not.toContain('createMCPClient');
    expect(knowledge['chat.mjs']).not.toContain('SandboxManager');
  });

  test('emits syntactically valid Agent Server files', () => {
    const agent = generatedFiles('assistant');
    const dir = mkdtempSync(join(tmpdir(), 'larkup-agent-server-'));
    try {
      for (const path of ['server.mjs', 'chat.mjs', 'models.mjs', 'widget.mjs']) {
        const file = join(dir, path);
        writeFileSync(file, agent[path], 'utf8');
        expect(() => execFileSync('node', ['--check', file], { stdio: 'pipe' })).not.toThrow();
      }

      const widget = join(dir, 'widget.mjs');
      expect(() =>
        execFileSync(
          'node',
          [
            '--input-type=module',
            '--eval',
            'const module = await import(process.argv[1]); if (!module.widgetScript.includes("document.createElement")) process.exit(1);',
            `file://${widget}`,
          ],
          { stdio: 'pipe' },
        ),
      ).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ships the saved prompt and enabled skills with the Agent runtime', () => {
    const agent = Object.fromEntries(
      generateServer({
        ...DEFAULT_CONFIG,
        runtimeProfile: 'assistant',
        systemPrompt: 'Always cite the source material.',
        skills: [
          {
            id: 'research',
            name: 'Research workflow',
            description: 'Research before answering.',
            source: 'inline',
            content: 'Use primary sources.',
            updatedAt: new Date().toISOString(),
          },
        ],
      }).files.map((file) => [file.path, file.contents]),
    );

    expect(agent['chat.mjs']).toContain('Always cite the source material.');
    expect(agent['chat.mjs']).toContain('AVAILABLE AGENT SKILLS');
    expect(agent['chat.mjs']).toContain('Research workflow');
  });
});
