import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { runWithWorkspaceHost } from '../../core/src/workspace-host';
import { quickLook } from '../src/lib/media/video/quick-look';

test('bounded visual reading limits generation and preserves observed facts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'video-reading-budget-'));
  try {
    const media = path.join(directory, 'fixture.mp4');
    await writeFile(media, 'decoder fixture');
    mock.method(childProcess, 'spawn', (command: string, args: string[]) => {
      assert.equal(command, 'ffmpeg');
      const child = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        kill: () => true,
      });
      queueMicrotask(async () => {
        try {
          await writeFile(
            args.at(-1)!.replace('%04d', '0001'),
            Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
          );
          child.emit('close', 0);
        } catch (error) {
          child.emit('error', error);
        }
      });
      return child as any;
    });
    syncBuiltinESMExports();
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        assert.equal(options.reasoning, 'low');
        assert.equal(options.maxOutputTokens, 2048);
        assert.ok(
          options.prompt.some(
            (m) =>
              m.role === 'user' &&
              Array.isArray(m.content) &&
              m.content.some((c) => c.type === 'file'),
          ),
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                found: 'The panel is blue.',
                settlesQuestion: true,
                read: [],
                confidence: 'high',
              }),
            },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        };
      },
    });
    const findings = await runWithWorkspaceHost(
      {
        project: { id: 'test', name: 'test' },
        readState: async () => null,
        writeState: async () => {},
        trackUsage: async (event: any) => event,
      } as any,
      () =>
        quickLook({
          mediaPath: media,
          question: 'What color is the panel?',
          ranges: [{ startSecs: 0, endSecs: 0.8 }],
          model: model as any,
          maxRetries: 0,
        }),
    );
    assert.equal(findings[0].found, 'The panel is blue.');
    assert.equal(findings[0].settlesQuestion, true);
    assert.ok(findings[0].frameCount > 0);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    await rm(directory, { recursive: true, force: true });
  }
});
