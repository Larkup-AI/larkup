import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  widgetScript,
  reactWidgetSnippet,
  agentSdkSnippet,
  serverOpenApiDocument,
  scalarReferenceHtml,
} from '../src/index.js';

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

test('serverOpenApiDocument returns valid OpenAPI documents for agent and knowledge profiles', () => {
  const agentDoc = serverOpenApiDocument('agent');
  assert.equal(agentDoc.openapi, '3.1.0');
  assert.equal(agentDoc.info.title, 'Larkup Agent Server');
  assert.ok(agentDoc.paths['/agent/chat']);
  assert.ok(agentDoc.paths['/query']);

  const knowledgeDoc = serverOpenApiDocument('knowledge');
  assert.equal(knowledgeDoc.info.title, 'Larkup Knowledge Server');
  assert.equal(knowledgeDoc.paths['/agent/chat'], undefined);
  assert.ok(knowledgeDoc.paths['/query']);

  const scalarHtml = scalarReferenceHtml();
  assert.match(scalarHtml, /@scalar\/api-reference/);
  assert.match(scalarHtml, /\/openapi\.json/);
});
