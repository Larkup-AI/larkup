import assert from 'node:assert/strict';
import test from 'node:test';
import { verifiedAnalysisTextStream } from '../src/lib/chat/analysis-response-stream';
import { recoverEmptyUIMessageStream } from '../src/lib/chat/tool-context';

async function collect(stream: ReadableStream<any>) {
  const reader = stream.getReader();
  const parts: any[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) return parts;
    parts.push(next.value);
  }
}
function input(parts: any[]) {
  return new ReadableStream<any>({
    start(controller) {
      parts.forEach((part) => controller.enqueue(part));
      controller.close();
    },
  });
}
const text = (id: string, value: string) => [
  { type: 'text-start', id },
  { type: 'text-delta', id, delta: value },
  { type: 'text-end', id },
];

test('speculative numerical claims are hidden until a successful analysis returns evidence', async () => {
  const result = await collect(
    input([
      ...text('plan', 'The total is 999999.'),
      { type: 'tool-input-available', toolName: 'executeAnalysis', toolCallId: 'a' },
      {
        type: 'tool-output-available',
        toolCallId: 'a',
        output: { exitCode: 0, stdout: 'Total: 17' },
      },
      ...text('answer', 'The verified total is 17.'),
    ]).pipeThrough(verifiedAnalysisTextStream(true)),
  );
  assert.deepEqual(
    result.filter((part) => part.type === 'text-delta').map((part) => part.delta),
    ['The verified total is 17.'],
  );
  assert.ok(result.some((part) => part.type === 'tool-input-available'));
});
test('failed calculations cannot unlock prose, and recovery still closes with a clear answer', async () => {
  const result = await collect(
    input([
      { type: 'tool-input-available', toolName: 'executeAnalysis', toolCallId: 'a' },
      {
        type: 'tool-output-available',
        toolCallId: 'a',
        output: { exitCode: 1, stdout: 'Unverified: 999999' },
      },
      ...text('unsupported', 'The total is 999999.'),
      { type: 'data-service-error', data: { code: 'MODEL_BUDGET_EXCEEDED' }, transient: true },
    ])
      .pipeThrough(verifiedAnalysisTextStream(true))
      .pipeThrough(recoverEmptyUIMessageStream('The calculation could not be verified.')()),
  );
  assert.deepEqual(
    result.filter((part) => part.type === 'text-delta').map((part) => part.delta),
    ['The calculation could not be verified.'],
  );
  assert.ok(result.some((part) => part.type === 'data-service-error'));
});
test('non-analytical source answers retain their streaming text', async () => {
  const result = await collect(
    input(text('answer', 'The source explains this.')).pipeThrough(
      verifiedAnalysisTextStream(false),
    ),
  );
  assert.equal(
    result.filter((part) => part.type === 'text-delta')[0].delta,
    'The source explains this.',
  );
});
