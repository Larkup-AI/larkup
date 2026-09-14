import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../types';
import { generateChatModule } from './chat-module';

test('agent server registers the interactive chart tool', () => {
  const source = generateChatModule({ ...DEFAULT_CONFIG, runtimeProfile: 'assistant' });

  assert.match(source, /tools\.generateVisualization = tool/);
  assert.match(source, /Create an interactive chart from rows already returned by another tool/);
});
