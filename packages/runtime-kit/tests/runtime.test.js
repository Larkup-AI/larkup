import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { widgetScript, reactWidgetSnippet, agentSdkSnippet } from '../src/index.js';

test('widget remains a standalone browser script with the Local chat contract', () => {
  const script = widgetScript({ widget: { title: 'Shared agent' } });
  new vm.Script(script);
  assert.match(script, /Shared agent/);
  assert.match(script, /text-delta/);
  assert.match(script, /Authorization/);
});

test('React snippet escapes settings as data and cleans up the script and widget', () => {
  const snippet = reactWidgetSnippet({
    baseUrl: 'https://agent.test/',
    apiKey: "key'\n",
    widget: { customCss: '` ${unexpected}' },
  });
  assert.ok(snippet.includes(JSON.stringify("key'\n")));
  assert.ok(snippet.includes(JSON.stringify('` ${unexpected}')));
  assert.match(snippet, /https:\/\/agent.test\/widget.js/);
  assert.match(snippet, /script.remove/);
  assert.match(snippet, /LarkupWidget\?\.destroy/);
  assert.match(agentSdkSnippet('https://agent.test'), /LarkupAgentClient/);
  assert.match(agentSdkSnippet('https://agent.test'), /chatText/);
});
