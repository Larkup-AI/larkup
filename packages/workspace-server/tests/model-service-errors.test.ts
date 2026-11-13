import assert from 'node:assert/strict';
import test from 'node:test';
import { modelServiceError } from '../src/lib/chat/model-service-errors';

test('nested Gateway budget failures give an actionable error without exposing account details', () => {
  const result = modelServiceError(
    {
      message: 'Gateway request failed',
      cause: { message: 'Team budget exceeded. Current spend: $12.34, limit: $12.00.' },
    },
    'vercel_ai_gateway',
  );
  assert.equal(result?.code, 'MODEL_BUDGET_EXCEEDED');
  assert.match(result?.message ?? '', /team owner/);
  assert.ok(!result?.message.includes('12.34'));
});
test('an unavailable model is distinguished from an answer failure', () => {
  assert.equal(
    modelServiceError({ message: "Model 'retired' not found" }, 'vercel_ai_gateway')?.code,
    'MODEL_UNAVAILABLE',
  );
  assert.equal(modelServiceError({ message: 'Ordinary calculation failed' }, 'openai'), undefined);
});
