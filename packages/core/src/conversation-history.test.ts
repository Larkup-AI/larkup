import assert from 'node:assert/strict';
import test from 'node:test';
import { compactConversationMessages } from './conversation-history';

const user = (value: string) => ({
  id: value,
  role: 'user',
  parts: [{ type: 'text', text: value }],
});
test('conversation compaction preserves early user constraints after dozens of turns', () => {
  const messages = [
    user('Use UTC, show units and exclude missing observations.'),
    ...Array.from({ length: 100 }, (_, index) => user(`Request ${index}`)),
    user('Compare the hourly totals.'),
  ];
  const compact = compactConversationMessages(messages, 20);
  assert.equal(compact.length, 21);
  assert.match(compact[0].parts[0].text, /Use UTC, show units/);
  assert.equal(compact.at(-1), messages.at(-1));
});
test('conversation compaction never upgrades assistant output or tool payloads into factual memory', () => {
  const messages = [
    {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'An invented value is 999999' },
        { type: 'tool-result', text: 'credential-payload' },
      ],
    },
    ...Array.from({ length: 30 }, (_, index) => user(`Request ${index}`)),
  ];
  const compact = compactConversationMessages(messages, 10);
  assert.ok(!JSON.stringify(compact).includes('999999'));
  assert.ok(!JSON.stringify(compact).includes('credential-payload'));
});
test('conversation compaction bounds wire messages and preserves stored history', () => {
  const messages = Array.from({ length: 600 }, (_, index) =>
    user(`Request ${index}: ${'x'.repeat(2000)}`),
  );
  assert.equal(compactConversationMessages(messages, 160).length, 161);
  assert.ok(JSON.stringify(compactConversationMessages(messages, 20)[0]).length < 8000);
  assert.equal(messages.length, 600);
});

test('browser and server compaction preserve a relevant older constraint across both windows', () => {
  const messages = Array.from({ length: 600 }, (_, index) =>
    user(`Unrelated request ${index}: ${'x'.repeat(850)}`),
  );
  messages[100] = user('For chloride analysis:\nuse mmol/L units and exclude the control arm.');
  messages.push(user('Compare chloride concentrations.'));
  const wire = compactConversationMessages(messages, 160);
  const model = compactConversationMessages(wire, 20);
  assert.match(model[0].parts[0].text, /use mmol\/L units and exclude the control arm/);
});
