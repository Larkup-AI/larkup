import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CHAT_POLICY } from '../src/lib/chat/chat-policy';

/**
 * CHAT_POLICY was decomposed into named sections in src/lib/chat/chat-policy.ts.
 * That refactor must stay behavior-preserving: the exact string handed to the
 * answer model may only change through the benchmark regression gate, never as
 * an accidental side effect of editing a section. This locks the composed
 * prompt to the golden snapshot captured from the original single-literal
 * policy. Regenerate the golden intentionally (and review the diff) when a
 * policy change has been validated.
 */
const golden = readFileSync(
  fileURLToPath(new URL('./fixtures-chat-policy.golden.txt', import.meta.url)),
  'utf8',
);

test('CHAT_POLICY composes to the exact golden policy string', () => {
  assert.equal(CHAT_POLICY, golden);
});

test('CHAT_POLICY keeps its framing newlines and paragraph structure', () => {
  assert.ok(CHAT_POLICY.startsWith('\n'), 'leading newline preserved');
  assert.ok(CHAT_POLICY.endsWith('\n'), 'trailing newline preserved');
  // 18 blank-line separated sections (one of which is PERSONALIZED_RESPONSE_STYLE).
  assert.equal(CHAT_POLICY.split('\n\n').length, 18);
});
