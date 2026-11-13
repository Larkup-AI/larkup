/** Classify service failures without exposing provider payloads, keys, or account details. */
export function modelServiceError(
  error: unknown,
  provider: string,
): { code: string; message: string } | undefined {
  const messages: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || !value) return;
    if (typeof value === 'string') {
      messages.push(value);
      return;
    }
    if (typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string') messages.push(record.message);
    for (const key of ['cause', 'lastError', 'error']) visit(record[key], depth + 1);
  };
  visit(error, 0);
  const text = messages.join(' ');
  if (
    /budget.{0,60}(?:exceed|reach|exhaust)|(?:insufficient|exhausted|out of).{0,30}credits|credits.{0,30}(?:exhaust|insufficient)/iu.test(
      text,
    )
  ) {
    return {
      code: 'MODEL_BUDGET_EXCEEDED',
      message:
        provider === 'vercel_ai_gateway'
          ? 'The AI Gateway team budget has been reached. A team owner must update the budget before this request can continue.'
          : 'The AI provider budget or credits are exhausted. Update the provider account before retrying.',
    };
  }
  if (/model_not_found|model.{0,100}not found/iu.test(text)) {
    return {
      code: 'MODEL_UNAVAILABLE',
      message: 'The selected model is unavailable. Choose an available model and try again.',
    };
  }
  return undefined;
}
